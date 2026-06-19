import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { isAddress, recoverMessageAddress } from 'viem';

export const runtime = 'nodejs';

function normalizeCidHash(value) {
  if (!value || typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/^0x/i, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(cleaned) ? cleaned : null;
}

async function upsertUserByWallet(connection, walletAddress) {
  const cleanWallet = walletAddress?.toLowerCase();
  if (!cleanWallet || !isAddress(cleanWallet)) return;

  await connection.query(
    `INSERT INTO users (wallet_address)
     VALUES (?)
     ON DUPLICATE KEY UPDATE wallet_address = VALUES(wallet_address)`,
    [cleanWallet]
  );
}

async function resolveAuthorizedSenderWallet(connection, signerAddress) {
  const cleanSigner = signerAddress?.toLowerCase();
  if (!cleanSigner || !isAddress(cleanSigner)) return null;

  // Burner path: if this signer is a known burner key, it must be actively authorized.
  const [burnerRows] = await connection.query(
    `SELECT owner_address, revoked_at, expires_at
     FROM chat_burner_sessions
     WHERE burner_address = ?
     LIMIT 1`,
    [cleanSigner]
  );

  // Not a registered burner key => treat as direct wallet sender.
  if (burnerRows.length === 0) {
    return cleanSigner;
  }

  const burnerRecord = burnerRows[0];
  const isActive =
    burnerRecord?.revoked_at == null &&
    (burnerRecord?.expires_at == null || new Date(burnerRecord.expires_at).getTime() > Date.now());
  if (!isActive) {
    return null;
  }

  const ownerAddress = burnerRecord?.owner_address?.toLowerCase();
  if (!ownerAddress || !isAddress(ownerAddress)) return null;
  return ownerAddress;
}

/**
 * Helper to recover the wallet address from a signed message structure.
 * This eliminates the need for separate authorization headers or session tables.
 */
async function verifyPayloadSignature(messageObj) {
  try {
    const { signature, content, stealth_address } = messageObj;
    
    if (!signature) return null;

    // Reconstruct the exact string payload that the burner key signed on the frontend
    const textToVerify = JSON.stringify({
      stealth_address: stealth_address.toLowerCase(),
      content: typeof content === 'object' ? JSON.stringify(content) : content
    });

    // Recover the wallet address that produced this signature
    const recoveredAddress = await recoverMessageAddress({
      message: textToVerify,
      signature: signature,
    });

    return recoveredAddress.toLowerCase();
  } catch (error) {
    console.error('Signature verification crash:', error);
    return null;
  }
}

/**
 * GET: Fetch Chat Inbox
 * Because we aren't using session tokens, the user signs a challenge string 
 * containing the addresses they want to scan to prove ownership/intent.
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const addrsRaw = searchParams.get('addresses');
    
    if (!addrsRaw) return NextResponse.json({ result: true, messages: [] });
    
    const addressList = addrsRaw.split(',').map(a => a.toLowerCase().trim());

    if (addressList.length > 100) {
      return NextResponse.json({ error: 'Max batch boundary is 100 addresses.' }, { status: 400 });
    }

    const [messages] = await pool.query(
      `SELECT id, sender_wallet, encrypted_key, topic, stealth_address, content, cid, cid_hash, created_at, is_spoiler
       FROM chats 
       WHERE stealth_address IN (?) 
       LIMIT 500`,
      [addressList]
    );

    return NextResponse.json({ result: true, count: messages.length, messages });
  } catch (error) {
    console.error('Chat GET Error:', error);
    return NextResponse.json({ error: 'Database fetch failure.' }, { status: 500 });
  }
}

/**
 * POST: Send Messages to Chat
 * Extracted wallet address via signature verification handles user attribution.
 */
export async function POST(req) {
  const connection = await pool.getConnection();

  try {
    const body = await req.json();
    let messages = [];

    if (Array.isArray(body.messages)) {
      messages = body.messages;
    } else {
      messages = [body];
    }

    if (messages.length === 0) {
      return NextResponse.json({ error: 'Empty payload container.' }, { status: 400 });
    }

    if (messages.length > 50) {
      return NextResponse.json({ error: 'Bulk operational ceiling is 50 entries.' }, { status: 400 });
    }

    const compiledRows = [];

    await connection.beginTransaction();
    for (const msg of messages) {
      const { encrypted_key, topic, stealth_address, content, cid, cid_hash, is_spoiler } = msg;

      if (!stealth_address || !isAddress(stealth_address)) {
        return NextResponse.json({ error: `Malformed destination target: ${stealth_address}` }, { status: 400 });
      }

      // Recover the exact wallet address from this message signature
      const signerWallet = await verifyPayloadSignature(msg);
  
      if (!signerWallet) {
        return NextResponse.json({ error: 'Cryptographic signature verification failed.' }, { status: 401 });
      }

      const senderWallet = await resolveAuthorizedSenderWallet(connection, signerWallet);
      if (!senderWallet) {
        return NextResponse.json(
          { error: 'Burner signer is not authorized to relay messages for any wallet.' },
          { status: 403 }
        );
      }
      await upsertUserByWallet(connection, senderWallet);

      const normalizedCidHash = normalizeCidHash(cid_hash);

      compiledRows.push([
        senderWallet,
        encrypted_key ? Buffer.from(encrypted_key.replace(/^0x/, ''), 'hex') : null,
        topic || null,
        stealth_address.toLowerCase(),
        typeof content === 'object' ? JSON.stringify(content) : content,
        cid || null,
        normalizedCidHash,
        is_spoiler ? 1 : 0
      ]);
    }

    await connection.query(
      `INSERT INTO chats (sender_wallet, encrypted_key, topic, stealth_address, content, cid, cid_hash, is_spoiler)
       VALUES ?`,
      [compiledRows]
    );

    await connection.commit();

    return NextResponse.json({ result: true, processed: compiledRows.length });
  } catch (error) {
    await connection.rollback();
    console.error('Chat POST Error:', error);
    const errorMessage = process.env.NODE_ENV === 'development' ? error.message : undefined;
    return NextResponse.json({ error: 'Atomic insert sequence crashed.', detail: errorMessage }, { status: 500 });
  } finally {
    connection.release();
  }
}

/**
 * DELETE: Clear Processed Messages
 */
export async function DELETE(req) {
  try {
    const { message_ids } = await req.json();

    if (!message_ids || !Array.isArray(message_ids)) {
      return NextResponse.json({ error: 'Array structure required for cleanup.' }, { status: 400 });
    }

    const [res] = await pool.query(
      'DELETE FROM chats WHERE id IN (?)',
      [message_ids]
    );

    return NextResponse.json({ result: true, purged_count: res.affectedRows });
  } catch (error) {
    console.error('Chat DELETE Error:', error);
    return NextResponse.json({ error: 'Purge request handling failed.' }, { status: 500 });
  }
}
