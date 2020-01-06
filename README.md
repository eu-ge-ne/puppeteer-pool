# puppeteer-pool

## About

Page pooling for Puppeteer. Written in TypeScript. Each page is opened in new browser instance.

## Install

```bash
$ npm install @eu-ge-ne/puppeteer-pool
```

## Example

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
        await page.destroy(page);
    }
}
```

## API

### Create instance

```typescript
import { PuppeteerPool } from "@eu-ge-ne/puppeteer-pool";

const pool = new PuppeteerPool({
    launchOptions: { }, // Puppeteer's LaunchOptions
    concurrency: 1, // Pool's concurrency
});
```

### Acquire page

```typescript
const page = await pool.acquire();
```

### Destroy page

```typescript
await page.destroy(page);
```

### Get status

```typescript
const [{ lifetime, counter, active }, ...rest] = pool.status();
```

Returns array of browser descriptors:

 - `lifetime: number` - browser instance lifetime in ms
 - `counter: number` - number of pages, opened by this browser instance
    (max value is equal to `concurrency` parameter)
 - `active: number` - number of active pages (browser instance will be
    destroyed when `counter === concurrency` and `active === 0`)

## License

[MIT](LICENSE)
