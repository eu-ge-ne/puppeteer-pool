@eu-ge-ne/puppeteer-pool
========================

Page pooling for Puppeteer. Written in TypeScript. Each page is opened in new browser instance.

[Example](#Example) | [Api](#Api) | [License](#License)

Install
-------

```bash
$ npm install @eu-ge-ne/puppeteer-pool
```

Example
-------

```typescript
import { PuppeteerPool } from "@eu-ge-ne/puppeteer-pool";

const pool = new PuppeteerPool({
    launchOptions: {
        ignoreHTTPSErrors: true,
        timeout: 60000,
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-features=site-per-process",
            "--disable-extensions",
        ],
    },
    concurrency: 100,
});

let page: Page | undefined;

try {
    page = await pool.acquire();
    page.on("error", err => console.log(err));
    // ...
} catch (err) {
    // ...
} finally {
    if (page) {
        await pool.destroy(page);
    }
}
```

API
---

### Create instance

```typescript
import { PuppeteerPool, LaunchOptions } from "@eu-ge-ne/puppeteer-pool";

// LaunchOptions for puppeteer
const launchOptions: LaunchOptions = {};

// Concurrency of the pool
const concurrency = 2;

const pool = new PuppeteerPool({ launchOptions, concurrency });
```

Or, provide `launch` option with function returning `Promise<Browser>`:

```typescript
import { PuppeteerPool, launch } from "@eu-ge-ne/puppeteer-pool";

const pool = new PuppeteerPool({
    launch: () => launch({
        ignoreHTTPSErrors: true,
        timeout: 60000,
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-features=site-per-process",
            "--disable-extensions",
        ],
    }),
    concurrency: 1,
});
```

### Acquire page

```typescript
const page = await pool.acquire();
```

### Destroy page

```typescript
await pool.destroy(page);
```

### Get status

```typescript
const [{ lifetime, counter, active }, ...rest] = pool.status();
```

Returns array of browser descriptors:

- `lifetime: number` - browser instance lifetime in ms
- `counter: number` - number of pages, opened by this browser instance (max value is equal to `concurrency` parameter)
- `active: number` - number of active pages (browser instance will be destroyed when `counter === concurrency` and `active === 0`)

License
-------

[MIT](LICENSE)
