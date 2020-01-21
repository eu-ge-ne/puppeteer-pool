@eu-ge-ne/puppeteer-pool
========================

Page pooling for Puppeteer. Written in TypeScript. Each page is opened in new browser instance.

###### [Install](#Install) | [Example](#Example) | [API](#API) | [License](#License)

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
    concurrency: 100,
    launchOptions: {
        headless: true,
    },
});

let page: Page | undefined;

try {
    page = await pool.acquire();
    page.on("error", err => console.log(err));
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

/**
 * Concurrency of the pool
 * Defaults to 1
 */
const concurrency = 100;

/**
 * Maximum time in milliseconds to wait for acquire
 * Defaults to 45_000
 * Should be greater than launchOptions.timeout
 */
const acquireTimeout: number = 60_000;

/**
 * Options, provided to default puppeteer.launch()
 */
const launchOptions: LaunchOptions = {};

const pool = new PuppeteerPool({ concurrency, acquireTimeout, launchOptions });
```

Or, provide `launch` option with function `() => Promise<Browser>`:

```typescript
import { PuppeteerPool, launch } from "@eu-ge-ne/puppeteer-pool";

const pool = new PuppeteerPool({
    concurrency: 100,
    launch: () => launch({
        headless: true,
    }),
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

### Destroy all pages

```typescript
await pool.destroyAll();
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
const pool = new PuppeteerPool<{ attempt: number }>({ concurrency: 100 });

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

#### error

Emitted when error occurred

```typescript
// ...

pool.on("error", err => console.log(err));
```

License
-------

[MIT](LICENSE)
