// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

/**
 * @title ISunriseRenderer
 * @author Hup Labs
 * @notice Minimal interface for the deployed Sunrise art renderer, so the token contract can
 *         call it by address without carrying the renderer's bytecode.
 * @dev The renderer lives behind an address purely for contract size: the SVG generator inlines
 *      to more code than fits alongside a full LSP8 implementation under the 24 KB limit.
 */
interface ISunriseRenderer {
  /// @notice Render the SVG for one Sunrise. Pure — same inputs always give identical bytes.
  function render(
    uint256 dayNumber,
    uint256 streak,
    uint256 positionOfDay,
    uint256 hourUTC
  ) external pure returns (string memory);
}

/**
 * @title SunriseRenderer
 * @author Hup Labs
 * @notice Deterministic, dependency-free flat-vector sunrise SVG.
 * @dev Pure function of (dayNumber, streak, positionOfDay, hourUTC).
 *      No block/tx/state reads, no external calls, no fonts, no raster,
 *      no `<image>`, no `<script>`. Same inputs -> byte-identical bytes.
 *      Worst-case output (streak >= 32, positionOfDay == 1, tier 4) is
 *      ~2.9 KB; MAX_BYTES documents the 8 KB ceiling the design holds to.
 *
 *      Draw order is load-bearing: rays are emitted before the ground, so the half of each ray
 *      that points below the horizon is painted over rather than clipped. Moving `_ground`
 *      earlier would expose them.
 * @custom:version 1.0.0
 * @custom:website https://hup.social
 * @custom:emoji 🌅
 */
library SunriseRenderer {
  uint256 internal constant MAX_BYTES = 8192;
  uint256 private constant HORIZON = 640;
  uint256 private constant MAX_RAYS = 32;

  // ---------------------------------------------------------------- render

  function render(
    uint256 dayNumber,
    uint256 streak,
    uint256 positionOfDay,
    uint256 hourUTC
  ) internal pure returns (string memory) {
    uint256[5] memory h = hues(dayNumber);
    uint256 tier = tierOf(streak);
    uint256 cy = sunY(hourUTC);
    uint256 n = streak > MAX_RAYS ? MAX_RAYS : streak;

    return
      string(
        abi.encodePacked(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000">',
          _bands(h),
          _rays(n, cy, tier, h[4]),
          _sun(cy, tier, h),
          _ground(h),
          positionOfDay == 1 ? _mark(h) : bytes(""),
          "</svg>"
        )
      );
  }

  // ------------------------------------------------------------- derivation

  /// @dev Five band hues from keccak(dayNumber). Domain-separated so the
  ///      same dayNumber in another renderer cannot collide.
  function hues(uint256 dayNumber) internal pure returns (uint256[5] memory h) {
    uint256 s = uint256(keccak256(abi.encodePacked("SUNRISE.v1", dayNumber)));
    uint256 base = s % 360;
    uint256 spread = 8 + ((s >> 16) % 26); // 8..33 deg between bands
    bool ccw = ((s >> 40) & 1) == 1;
    for (uint256 i; i < 5; ++i) {
      h[i] = ccw ? (base + 360 * 5 - i * spread) % 360 : (base + i * spread) % 360;
    }
  }

  /// @dev 0 -> deep night (sun buried), 12 -> zenith. Symmetric around noon.
  function sunY(uint256 hourUTC) internal pure returns (uint256) {
    uint256 hr = hourUTC % 24;
    uint256 elev = hr <= 12 ? hr : 24 - hr; // 0..12
    return HORIZON + 70 - elev * 34; // 710 .. 302
  }

  /// @dev MUST stay identical to `SunriseGM.tierOf` — the art and the Milestone metadata trait
  ///      are two readings of the same streak. Change both or neither.
  function tierOf(uint256 streak) internal pure returns (uint256) {
    if (streak >= 365) return 4;
    if (streak >= 100) return 3;
    if (streak >= 30) return 2;
    if (streak >= 7) return 1;
    return 0;
  }

  // ------------------------------------------------------------------ parts

  function _bands(uint256[5] memory h) private pure returns (bytes memory out) {
    uint16[5] memory S = [uint16(58), 64, 70, 76, 84];
    uint16[5] memory L = [uint16(16), 26, 38, 52, 66];
    uint16[5] memory Y = [uint16(0), 170, 330, 460, 555];
    uint16[5] memory H = [uint16(170), 160, 130, 95, 85];
    for (uint256 i; i < 5; ++i) {
      out = abi.encodePacked(
        out,
        '<rect y="',
        _u(Y[i]),
        '" width="1000" height="',
        _u(H[i]),
        '" fill="',
        _hsl(h[i], S[i], L[i]),
        '"/>'
      );
    }
  }

  function _rays(uint256 n, uint256 cy, uint256 tier, uint256 hue) private pure returns (bytes memory p) {
    if (n == 0) return bytes("");
    uint256 w = tier >= 3 ? 14 : 9;
    p = abi.encodePacked('<g transform="translate(500,', _u(cy), ')" fill="', _hsl(hue, 90, 72), '">');
    for (uint256 i; i < n; ++i) {
      p = abi.encodePacked(
        p,
        '<path d="M0 0L-',
        _u(w),
        " -900L",
        _u(w),
        ' -900Z" transform="rotate(',
        _deci((i * 3600) / n),
        ')"/>'
      );
    }
    p = abi.encodePacked(p, "</g>");
  }

  function _sun(uint256 cy, uint256 tier, uint256[5] memory h) private pure returns (bytes memory s) {
    s = _disc(cy, 120, _hsl(h[4], 92, 60));
    if (tier >= 1) s = abi.encodePacked(s, _disc(cy, 66, _hsl(h[4], 96, 82)));
    if (tier >= 2) s = abi.encodePacked(s, _ring(cy, 144, 8, _hsl(h[3], 88, 68), ""));
    if (tier >= 3) s = abi.encodePacked(s, _ring(cy, 172, 4, _hsl(h[3], 88, 74), ""));
    if (tier >= 4) {
      s = abi.encodePacked(s, _ring(cy, 208, 14, _hsl(h[4], 92, 76), ' stroke-dasharray="24 20"'));
    }
  }

  function _ground(uint256[5] memory h) private pure returns (bytes memory) {
    return
      abi.encodePacked(
        '<rect y="634" width="1000" height="10" fill="',
        _hsl(h[0], 60, 9),
        '"/>',
        '<rect y="644" width="1000" height="356" fill="',
        _hsl(h[0], 52, 14),
        '"/>'
      );
  }

  /// @dev Position-of-day marker: nested diamond, top-left, never collides
  ///      with the sun at any hour or tier.
  function _mark(uint256[5] memory h) private pure returns (bytes memory) {
    return
      abi.encodePacked(
        '<path d="M110 58L162 110L110 162L58 110Z" fill="',
        _hsl(h[4], 96, 86),
        '"/>',
        '<path d="M110 86L134 110L110 134L86 110Z" fill="',
        _hsl(h[0], 70, 18),
        '"/>'
      );
  }

  function _disc(uint256 cy, uint256 r, string memory fill) private pure returns (bytes memory) {
    return abi.encodePacked('<circle cx="500" cy="', _u(cy), '" r="', _u(r), '" fill="', fill, '"/>');
  }

  function _ring(
    uint256 cy,
    uint256 r,
    uint256 sw,
    string memory stroke,
    string memory extra
  ) private pure returns (bytes memory) {
    return
      abi.encodePacked(
        '<circle cx="500" cy="',
        _u(cy),
        '" r="',
        _u(r),
        '" fill="none" stroke="',
        stroke,
        '" stroke-width="',
        _u(sw),
        '"',
        extra,
        "/>"
      );
  }

  // ---------------------------------------------------------------- helpers

  function _hsl(uint256 h, uint256 s, uint256 l) private pure returns (string memory) {
    return string(abi.encodePacked("hsl(", _u(h), ",", _u(s), "%,", _u(l), "%)"));
  }

  /// @dev One decimal place, e.g. 1125 -> "112.5". Integer-only, so the
  ///      angle sequence is identical on every EVM.
  function _deci(uint256 v) private pure returns (string memory) {
    return string(abi.encodePacked(_u(v / 10), ".", _u(v % 10)));
  }

  function _u(uint256 v) private pure returns (string memory) {
    if (v == 0) return "0";
    uint256 d;
    for (uint256 t = v; t != 0; t /= 10) ++d;
    bytes memory b = new bytes(d);
    while (v != 0) {
      b[--d] = bytes1(uint8(48 + (v % 10)));
      v /= 10;
    }
    return string(b);
  }
}

/**
 * @title SunriseRendererV1
 * @author Hup Labs
 * @notice Deployable wrapper that makes the pure library reachable by address.
 * @dev Deploy once, point the token contract at it, then lock it. `render` is `pure`, so callers
 *      reach it with STATICCALL and a future renderer cannot mutate the token contract's storage
 *      even if it tried.
 * @custom:version 1.0.0
 * @custom:website https://hup.social
 * @custom:emoji 🌅
 */
contract SunriseRendererV1 is ISunriseRenderer {
  /// @inheritdoc ISunriseRenderer
  function render(
    uint256 dayNumber,
    uint256 streak,
    uint256 positionOfDay,
    uint256 hourUTC
  ) external pure override returns (string memory) {
    return SunriseRenderer.render(dayNumber, streak, positionOfDay, hourUTC);
  }
}
