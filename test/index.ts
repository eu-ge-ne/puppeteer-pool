import test from "ava";

import { Page, launch } from "puppeteer";
import { PuppeteerPool } from "../src";

test("example", async t => {
    t.plan(1);

    const pool = new PuppeteerPool({
        concurrency: 100,
        launchOptions: {
            headless: true,
        },
    });

    let page!: Page;

    try {
        page = await pool.acquire();
        page.on("error", err => console.log(err));
    } finally {
        if (page) {
            pool.close(page);
        }
    }

    t.pass();
});

test("Custom launch() called when provided", async t => {
    t.plan(1);

    const pool = new PuppeteerPool({
        launch: () => {
            t.pass("Custom launch() called");
            return launch({ headless: true });
        }
    });

    await pool.acquire();

    pool.closeAll();
});

test("acquire() returns Page", async t => {
    const pool = new PuppeteerPool({ launchOptions: { headless: true } });

    const page = await pool.acquire();

    t.truthy(page);

    pool.closeAll();
});

test("stats() returns stats object", async t => {
    const pool = new PuppeteerPool({ launchOptions: { headless: true } });

    await pool.acquire();

    const stats = pool.stats();

    const {
        browsers: [
            {
                lifetime,
                counter,
                active,
            },
            ...rest
        ],
        acquireTime: {
            max,
            mean,
        }
    } = stats;

    t.assert(stats.browsers.length === 1);
    t.assert(lifetime >= 0);
    t.assert(counter === 1);
    t.assert(active === 1);

    pool.closeAll();
});

test("close() throws error for page not created by acquire()", async t => {
    const pool = new PuppeteerPool({ launchOptions: { headless: true } });

    const browser = await launch({ headless: true });
    const page = await browser.newPage();

    t.throws(() => pool.close(page),
        { instanceOf: Error, message: "Provided page does not belong to the pool" });

    await browser.close();
});

test("close() emits after_close event", async t => {
    const pool = new PuppeteerPool({ launchOptions: { headless: true } });

    t.plan(2);

    const page = await pool.acquire();

    let pageFromEvent: Page | null = null;

    pool.on("after_close", page => {
        t.pass("after_close emitted");
        pageFromEvent = page;
    });

    pool.close(page);

    await new Promise(x => setTimeout(x, 500));

    t.is(pageFromEvent, page);
});

test("Calling acquire() and close() n times ends with 0 browser instances", async t => {
    const pool = new PuppeteerPool({ concurrency: 10, launchOptions: { headless: true } });

    const pages = await Promise.all(new Array(10).fill(null).map(_ => pool.acquire()));

    for (let i = 0; i < 10; i += 1) {
        pool.close(pages[i]);
    }

    const stats = pool.stats();

    t.is(stats.browsers.length, 0);
});

test("After closeAll() all browsers and pages are closed", async t => {
    const pool = new PuppeteerPool({ concurrency: 10, launchOptions: { headless: true } });

    await Promise.all(new Array(10).fill(null).map(_ => pool.acquire()));

    pool.closeAll();

    const stats = pool.stats();

    t.is(stats.browsers.length, 0);
});

test("acquire() emits after_acquire event", async t => {
    const pool = new PuppeteerPool({ launchOptions: { headless: true } });

    t.plan(2);

    let pageFromEvent: Page | null = null;

    pool.on("after_acquire", page => {
        t.pass("after_acquire emitted");
        pageFromEvent = page;
    });

    const page = await pool.acquire();

    t.is(pageFromEvent, page);

    pool.closeAll();
});

test("acquire() emits after_acquire event with provided opts", async t => {
    type PageOpts = { a: number; b: number; c: number };

    const pool = new PuppeteerPool<PageOpts>({ launchOptions: { headless: true } });

    t.plan(2);

    const opts = { a: 1, b: 2, c: 3 };
    let optsFromEvent: PageOpts | null = null;

    pool.on("after_acquire", (page, opts) => {
        t.pass("after_acquire emitted");
        optsFromEvent = opts;
    });

    await pool.acquire(opts);

    t.is(optsFromEvent, opts);

    pool.closeAll();
});

test("acquire() respects concurrency", async t => {
    const pool = new PuppeteerPool({ concurrency: 2, acquireTimeout: 10_000, launchOptions: { headless: true } });

    await pool.acquire();
    await pool.acquire();

    await t.throwsAsync(() => pool.acquire(),
        { instanceOf: Error, message: "Acquire timeout: 10000 ms" });

    pool.closeAll();
});

test("Number of acquirers exceeds concurrency", async t => {
    const pool = new PuppeteerPool({ concurrency: 2, launchOptions: { headless: true } });

    const acquire = async () => {
        const page = await pool.acquire();
        pool.close(page);
    };

    const acquirers = new Array(10).fill(null).map(acquire);

    await t.notThrowsAsync(async () => await Promise.all(acquirers));
});

test("random", async t => {
    const pool = new PuppeteerPool({ concurrency: 10, launchOptions: { headless: true } });

    const run = async () => {
        const page = await pool.acquire();
        await new Promise(x => setTimeout(x, Math.round(Math.random() * 100)));
        pool.close(page);
    };

    await Promise.all(new Array(100).fill(null).map(run));

    const stats = pool.stats();

    t.is(stats.browsers.length, 0);
});
