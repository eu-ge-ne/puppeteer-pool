@eu-ge-ne/puppeteer-pool
========================

Page pooling for Puppeteer. Written in TypeScript. Each page is opened in new browser instance.

###### [Install](#Install) | [Example](#Example) | [Api](#Api) | [License](#License)

![](https://github.com/eu-ge-ne/puppeteer-pool/workflows/Tests/badge.svg)
[![npm version](https://badge.fury.io/js/%40eu-ge-ne%2Fpuppeteer-pool.svg)](https://badge.fury.io/js/%40eu-ge-ne%2Fpuppeteer-pool)

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

/** LaunchOptions for puppeteer */
const launchOptions: LaunchOptions = {};

/** Maximum time in milliseconds to wait for acquire. Defaults to 30000 */
const acquireTimeout: number = 30_000;

/** Concurrency of the pool */
const concurrency = 100;

const pool = new PuppeteerPool({ launchOptions, acquireTimeout, concurrency });
```

Or, provide `launch` option with function `() => Promise<Browser>`:

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
    concurrency: 100,
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

### Events

#### after_acquire

Emitted after page acquired. Useful for additional page setup:

```typescript
const pool = new PuppeteerPool<{ attempt: number }>({ concurrency: 1 });

pool.on("after_acquire", (page, opts) => {
    const timeout = opts.attempt * 1000 * 60;

    page.setDefaultNavigationTimeout(timeout);
    page.setDefaultTimeout(timeout);
});

// ...

const page = await pool.acquire({ attempt });

page.on("error", err => console.log(err));
page.on("console", msg => console.log(msg));
```

#### after_destroy

Emitted after page destroyed. For example can be used for unsubscribing:

```typescript
// ...

pool.on("after_destroy", page => page.removeAllListeners());
```

License
-------

[MIT](LICENSE)
