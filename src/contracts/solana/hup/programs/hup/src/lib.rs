//! Hup on Solana — the log-first social core.
//!
//! Every post, comment, repost, like and unlike is an event. The only account this program
//! keeps is one `Config` PDA: admin, treasury, fee, metadata cap and the post id counter.
//! Everything else — like de-duplication, counters, who may edit or delete a post — is
//! enforced by the indexer (cidex), which is already the read model for every Hup chain:
//! an update/delete whose `actor` is not the indexed creator is simply ignored.
//!
//! Ids are sequential u64s so they fit the same `posts.id` column as the EVM deployments;
//! they start at 1 and `parent_id == 0` means top-level. Because the counter lives in the
//! config account, "does this parent exist" is a free check on every create.
//!
//! Two signers can pay: `creator` is who the content is attributed to and `payer` is who
//! funds the create fee (if one is set). The transaction fee itself is paid by whoever signs
//! the transaction first — that is the whole gasless story here, no forwarder needed.
//!
//! Events use `emit!` (program logs) on purpose: Solana Playground cannot enable the
//! `event-cpi` Cargo feature. A single event per instruction is a few hundred bytes, far
//! under the 10 KB per-transaction log budget where truncation starts. The indexer already
//! decodes both `emit!` and `emit_cpi!`, so switching later needs no indexer change.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

// Devnet deployment (Solana Playground, 2026-08-24). Playground rewrites this on build.
declare_id!("9kNAEGDmFZ5iCrmPJRpcEjtFAfPUEhydLAm3YYEcDo5L");

// --- Constants ---

pub const CONFIG_SEED: &[u8] = b"config";

pub const KIND_POST: u8 = 0;
pub const KIND_COMMENT: u8 = 1;
pub const KIND_REPOST: u8 = 2;

pub const DEFAULT_MAX_METADATA_BYTES: u16 = 256;
/// A transaction is 1232 bytes; after signatures, keys and the instruction header roughly
/// 900 bytes remain for the metadata pointer, so the admin cap can never be raised past it.
pub const ABSOLUTE_MAX_METADATA_BYTES: u16 = 900;

// --- Logic ---

#[program]
pub mod hup {
    use super::*;

    // --- Admin ---

    /// Creates the single config account. Runs once, by whoever deploys.
    pub fn initialize(ctx: Context<Initialize>, admin: Pubkey, treasury: Pubkey) -> Result<()> {
        require!(admin != Pubkey::default(), HupError::InvalidAdmin);
        require!(treasury != Pubkey::default(), HupError::InvalidTreasury);

        let config = &mut ctx.accounts.config;
        config.admin = admin;
        config.treasury = treasury;
        config.fee_lamports = 0;
        config.next_id = 1;
        config.max_metadata_bytes = DEFAULT_MAX_METADATA_BYTES;
        config.paused = false;
        config.bump = ctx.bumps.config;

        emit_config(&*config);
        Ok(())
    }

    /// Updates any subset of the tunables; `None` leaves a field untouched.
    pub fn set_config(
        ctx: Context<Admin>,
        fee_lamports: Option<u64>,
        max_metadata_bytes: Option<u16>,
        treasury: Option<Pubkey>,
        paused: Option<bool>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;

        if let Some(value) = fee_lamports {
            config.fee_lamports = value;
        }
        if let Some(value) = max_metadata_bytes {
            require!(
                value > 0 && value <= ABSOLUTE_MAX_METADATA_BYTES,
                HupError::InvalidMetadataCap
            );
            config.max_metadata_bytes = value;
        }
        if let Some(value) = treasury {
            require!(value != Pubkey::default(), HupError::InvalidTreasury);
            config.treasury = value;
        }
        if let Some(value) = paused {
            config.paused = value;
        }

        emit_config(&*config);
        Ok(())
    }

    pub fn transfer_admin(ctx: Context<Admin>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), HupError::InvalidAdmin);

        let config = &mut ctx.accounts.config;
        config.admin = new_admin;

        emit_config(&*config);
        Ok(())
    }

    // --- Content ---

    /// Publishes a post (`kind` 0), comment (1) or repost (2). Mirrors the EVM `create`
    /// rules: posts have no parent, comments and reposts need an existing one, reposts
    /// carry no metadata and never allow comments.
    pub fn create(
        ctx: Context<Create>,
        kind: u8,
        parent_id: u64,
        metadata: String,
        allow_comments: bool,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(!config.paused, HupError::Paused);
        require!(kind <= KIND_REPOST, HupError::InvalidKind);

        let metadata_len = metadata.len();
        if kind == KIND_REPOST {
            require!(metadata_len == 0, HupError::RepostMetadataNotAllowed);
            require!(!allow_comments, HupError::InteractionNotAllowed);
        } else {
            require!(metadata_len > 0, HupError::InputEmpty);
        }
        require!(
            metadata_len <= config.max_metadata_bytes as usize,
            HupError::MetadataTooLarge
        );

        if kind == KIND_POST {
            require!(parent_id == 0, HupError::InvalidParent);
        } else {
            require!(
                parent_id != 0 && parent_id < config.next_id,
                HupError::ContentNotFound
            );
        }

        if config.fee_lamports > 0 {
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.payer.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                    },
                ),
                config.fee_lamports,
            )?;
        }

        let id = config.next_id;
        config.next_id = id.checked_add(1).ok_or(HupError::Overflow)?;

        emit!(ContentCreated {
            id,
            creator: ctx.accounts.creator.key(),
            kind,
            parent_id,
            metadata,
            allow_comments: kind != KIND_REPOST && allow_comments,
            created_at: Clock::get()?.unix_timestamp,
        });
        Ok(())
    }

    /// Replaces the metadata pointer of a post. Only honoured by the indexer when `actor`
    /// is the creator of that post — the program has no per-post state to check it against.
    pub fn update(
        ctx: Context<Act>,
        id: u64,
        metadata: String,
        allow_comments: bool,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, HupError::Paused);
        require_known(config, id)?;

        let metadata_len = metadata.len();
        require!(metadata_len > 0, HupError::InputEmpty);
        require!(
            metadata_len <= config.max_metadata_bytes as usize,
            HupError::MetadataTooLarge
        );

        emit!(ContentUpdated {
            id,
            actor: ctx.accounts.actor.key(),
            metadata,
            allow_comments,
        });
        Ok(())
    }

    /// Same ownership rule as `update`: the indexer ignores a delete from anyone else.
    pub fn delete(ctx: Context<Act>, id: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, HupError::Paused);
        require_known(config, id)?;

        emit!(ContentDeleted {
            id,
            actor: ctx.accounts.actor.key(),
        });
        Ok(())
    }

    pub fn like(ctx: Context<Act>, id: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, HupError::Paused);
        require_known(config, id)?;

        emit!(ContentLiked {
            id,
            actor: ctx.accounts.actor.key(),
        });
        Ok(())
    }

    pub fn unlike(ctx: Context<Act>, id: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, HupError::Paused);
        require_known(config, id)?;

        emit!(ContentUnliked {
            id,
            actor: ctx.accounts.actor.key(),
        });
        Ok(())
    }
}

/// An id is known once the counter has moved past it. Deleted posts stay "known": the
/// indexer decides what a like on a deleted post means, exactly as it does for EVM rows.
fn require_known(config: &Config, id: u64) -> Result<()> {
    require!(id != 0 && id < config.next_id, HupError::ContentNotFound);
    Ok(())
}

fn emit_config(config: &Config) {
    emit!(ConfigUpdated {
        admin: config.admin,
        treasury: config.treasury,
        fee_lamports: config.fee_lamports,
        max_metadata_bytes: config.max_metadata_bytes,
        paused: config.paused,
        next_id: config.next_id,
    });
}

// --- Accounts ---

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Admin<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = admin @ HupError::Unauthorized
    )]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct Create<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    /// The author. Attribution follows this signer, never the fee payer.
    pub creator: Signer<'info>,
    /// Whoever funds the create fee: the author, or a relayer sponsoring the post.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: only ever receives lamports, and is pinned to the configured treasury.
    #[account(mut, address = config.treasury @ HupError::InvalidTreasury)]
    pub treasury: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// Read-only config, so likes, edits and deletes never take a write lock on it and run in
/// parallel with each other and with creates.
#[derive(Accounts)]
pub struct Act<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub actor: Signer<'info>,
}

// --- Storage ---

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub fee_lamports: u64,
    /// Id the next create will receive; every id below it (and above 0) exists.
    pub next_id: u64,
    pub max_metadata_bytes: u16,
    pub paused: bool,
    pub bump: u8,
}

// --- Events ---
// Names and field order are the contract with the indexer (cidex/lib/solanaHup.js decodes
// these by discriminator and declared field order). Change them together.

#[event]
pub struct ContentCreated {
    pub id: u64,
    pub creator: Pubkey,
    pub kind: u8,
    pub parent_id: u64,
    pub metadata: String,
    pub allow_comments: bool,
    pub created_at: i64,
}

#[event]
pub struct ContentUpdated {
    pub id: u64,
    pub actor: Pubkey,
    pub metadata: String,
    pub allow_comments: bool,
}

#[event]
pub struct ContentDeleted {
    pub id: u64,
    pub actor: Pubkey,
}

#[event]
pub struct ContentLiked {
    pub id: u64,
    pub actor: Pubkey,
}

#[event]
pub struct ContentUnliked {
    pub id: u64,
    pub actor: Pubkey,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub fee_lamports: u64,
    pub max_metadata_bytes: u16,
    pub paused: bool,
    pub next_id: u64,
}

// --- Errors ---

#[error_code]
pub enum HupError {
    #[msg("The program is paused")]
    Paused,
    #[msg("Caller is not the admin")]
    Unauthorized,
    #[msg("Unknown content kind")]
    InvalidKind,
    #[msg("A post cannot have a parent")]
    InvalidParent,
    #[msg("Content not found")]
    ContentNotFound,
    #[msg("Metadata is empty")]
    InputEmpty,
    #[msg("Metadata exceeds the configured cap")]
    MetadataTooLarge,
    #[msg("A repost carries no metadata")]
    RepostMetadataNotAllowed,
    #[msg("Interaction not allowed")]
    InteractionNotAllowed,
    #[msg("Metadata cap out of range")]
    InvalidMetadataCap,
    #[msg("Invalid treasury")]
    InvalidTreasury,
    #[msg("Invalid admin")]
    InvalidAdmin,
    #[msg("Counter overflow")]
    Overflow,
}
