# @camaleonic/connect

Camaleonic Connect SDK — embed a one-click social-account connector in your
web app. Supported platforms: Facebook, Instagram (via Facebook), TikTok,
Threads, YouTube, Twitch.

## Install

```bash
npm i @camaleonic/connect
```

Or use the CDN-hosted IIFE:

```html
<script src="https://smconnector.camaleonicanalytics.com/connect-sdk.js"></script>
```

## Quickstart

1. Your backend mints a short-lived SDK token using your `cmlk_live_*` API key:
   ```http
   POST https://smconnector.camaleonicanalytics.com/v1/sdk-tokens
   Authorization: Bearer cmlk_live_xxx
   Content-Type: application/json

   {
     "user_id": "your-end-user-id",
     "ttl": 1800,
     "allowed_platforms": ["facebook", "instagram"],
     "products": { "facebook": ["identity", "audience"], "instagram": ["identity"] }
   }
   ```
   The response carries an HS256 JWT (`sdk_token`). `allowed_platforms` and
   `products` are optional — see [Per-connection product scope](#per-connection-product-scope).

2. Pass the token to the SDK in the browser:
   ```ts
   import CamaleonicConnect from '@camaleonic/connect';

   const handle = CamaleonicConnect.init({
     sdkToken,
     workspace: 'your-slug',
     platforms: ['twitch', 'instagram'],
     onSuccess: ({ accountIds, platform }) => persist(accountIds, platform),
     onError: (err) => console.warn(err),
     onExit: () => console.log('closed'),
   });

   button.onclick = () => handle.open('twitch'); // or .open() for the chooser
   ```

3. Once `onSuccess` fires, your backend can read the accounts:
   ```http
   GET https://smconnector.camaleonicanalytics.com/v1/accounts/<id>/identity
   Authorization: Bearer cmlk_live_xxx
   ```

## Options

| Option | Type | Required | Description |
|---|---|---|---|
| `sdkToken` | `string` | yes | HS256 JWT minted via `POST /v1/sdk-tokens` |
| `workspace` | `string` | yes | Workspace slug; must match the slug claim |
| `platforms` | `PlatformKey[]` | no | Allow-list. Calls to `.open(platform)` outside the list emit `invalid_platform`. |
| `baseUrl` | `string` | no | Override the connect-ui origin (defaults to script src origin) |
| `onSuccess` | `(d) => void` | no | Fired once when the popup posts back a success |
| `onError` | `(e) => void` | no | Fired on `popup_blocked` / `invalid_platform` / `unknown` |
| `onExit` | `() => void` | no | Fired when the user closes the popup without finishing |

`open(platform?)` returns nothing; success / error / exit is reported via
the callbacks. Callbacks fire **at most once** per `open()` call.

## Per-connection product scope

By default a connection enrols every product your workspace has enabled for the
chosen platform. To scope an individual connection to a subset — e.g. a "basic"
account that needs no Ads data — pass `products` when minting the token:

```http
POST /v1/sdk-tokens
Authorization: Bearer cmlk_live_xxx

{
  "user_id": "end-user-42",
  "products": { "facebook": ["identity", "audience"] }
}
```

- Shape: `Record<platform, productId[]>`. `identity` is always included
  automatically — `{ "facebook": [] }` connects a profile-only account.
- The scope must be a **subset of your workspace's enabled products**; anything
  outside the workspace allow-list is rejected at mint with `400`.
- Only the platforms you list are narrowed. Platforms you omit keep the full
  workspace allow-list, so scope every platform you want to restrict.
- The scope is signed into the token — the end user cannot widen it. The OAuth
  consent screen then requests only the scopes those products need.

## Security

- The popup origin is verified strictly — only messages from the configured
  `baseUrl` are accepted.
- The `sdkToken` is short-lived (≤30 min) and scoped to a single end-user.
- Your `cmlk_live_*` API key never enters the browser.

## Versioning

The npm package follows semver. The CDN URL `/connect-sdk.js` always
serves the latest v1; breaking changes will move to `/v2/connect-sdk.js`.
