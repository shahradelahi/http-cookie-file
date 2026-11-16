<h1 align="center">
  <sup>http-cookie-file</sup>
  <br>
  <a href="https://github.com/shahradelahi/http-cookie-file/actions/workflows/ci.yml"><img src="https://github.com/shahradelahi/http-cookie-file/actions/workflows/ci.yml/badge.svg?branch=main&event=push" alt="CI"></a>
  <a href="https://www.npmjs.com/package/http-cookie-file"><img src="https://img.shields.io/npm/v/http-cookie-file.svg" alt="NPM Version"></a>
  <a href="/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat" alt="MIT License"></a>
  <a href="https://bundlephobia.com/package/http-cookie-file"><img src="https://img.shields.io/bundlephobia/minzip/http-cookie-file" alt="npm bundle size"></a>
  <a href="https://packagephobia.com/result?p=http-cookie-file"><img src="https://packagephobia.com/badge?p=http-cookie-file" alt="Install Size"></a>
</h1>

_http-cookie-file_ is an atomic HTTP cookie jar supporting Netscape `cookies.txt` and JSON formats.

---

- [Installation](#-installation)
- [Usage](#-usage)
- [Documentation](#-documentation)
- [Contributing](#-contributing)
- [License](#license)

## 📦 Installation

```bash
npm install http-cookie-file
```

<details>
<summary>Install using your favorite package manager</summary>

**pnpm**

```bash
pnpm install http-cookie-file
```

**yarn**

```bash
yarn add http-cookie-file
```

</details>

## 📖 Usage

### Basic Usage

```ts
import { CookieFile } from 'http-cookie-file';

const cookies = new CookieFile('./cookies.txt');

// Load existing cookies
await cookies.load();

// Set cookie from raw Set-Cookie header
await cookies.setCookie(
  'sid=abc123; Path=/; Secure; HttpOnly',
  'https://example.com/login'
);

// Generate Cookie request header
const header = await cookies.getCookieHeader('https://example.com/api');
// -> "sid=abc123"
```

### JSON Format

Store cookies in JSON format instead of Netscape format.

```ts
const cookies = new CookieFile('./cookies.json', { format: 'json' });
await cookies.setCookie('session=xyz123', 'https://example.com');
```

### Response Header Ingestion

Ingest `Set-Cookie` headers directly from standard `Response` or `Headers` objects.

```ts
const response = await fetch('https://example.com/api/login');

// Extract and persist cookies from response
await cookies.setFromResponse(response, 'https://example.com/api/login');
```

### Structured Cookie Operations

Manage individual cookies with structured input, queries, and deletions.

```ts
// Add structured cookie
await cookies.set({
  name: 'theme',
  value: 'dark',
  domain: 'example.com',
  path: '/',
  secure: true,
  maxAge: 3600,
});

// Query matched cookies for URL
const list = await cookies.getCookies('https://example.com/dashboard');

// Delete specific cookie
await cookies.delete('theme', { domain: 'example.com', path: '/' });
```

### Session Persistence & Auto-Save

Configure automatic disk persistence and session cookie behavior.

```ts
const cookies = new CookieFile('./cookies.txt', {
  autoSave: true, // Automatically persist changes to disk
  persistSessionCookies: false, // Exclude session cookies from disk writes
});
```

### Utilities

Exposes low-level RFC 6265 and Netscape parser functions.

```ts
import {
  parseNetscapeCookies,
  parseSetCookie,
  serializeNetscapeCookies,
} from 'http-cookie-file';

// Parse Netscape cookies format text
const list = parseNetscapeCookies(rawContent);

// Serialize cookie list to Netscape format
const content = serializeNetscapeCookies(list);
```

## 📚 Documentation

For all configuration options, please see [the API docs](https://www.jsdocs.io/package/http-cookie-file).

## 🤝 Contributing

Want to contribute? Awesome! To show your support is to star the project, or to raise issues on [GitHub](https://github.com/shahradelahi/http-cookie-file).

Thanks again for your support, it is much appreciated! 🙏

## License

[MIT](/LICENSE) © [Shahrad Elahi](https://github.com/shahradelahi) and [contributors](https://github.com/shahradelahi/http-cookie-file/graphs/contributors).
