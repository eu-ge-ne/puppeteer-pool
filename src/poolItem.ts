import { Page, Browser } from "puppeteer";

export class PoolItem {
    private static nextId = 1;
    private readonly id = PoolItem.nextId++;
    private readonly created = Date.now();
    private pages: Page[] = [];
    private counter = 0;

    constructor(private concurrency: number, public readonly browser: Browser) {
    }

    addPage(page: Page) {
        this.pages.push(page);
        this.counter += 1;
    }

    removePage(page: Page) {
        const i = this.findPageIndex(page);
        if (i < 0) {
            throw new Error("Page not found");
        }
        this.pages.splice(i, 1);
    }

    removeAllPages(): Page[] {
        const pages = this.pages;
        this.pages = [];
        return pages;
    }

    findPageIndex(page: Page) {
        return this.pages.findIndex(x => x === page);
    }

    debug() {
        return `id: ${this.id}, counter: ${this.counter}, active: ${this.pages.length}`;
    }

    stats() {
        return {
            lifetime: Date.now() - this.created,
            counter: this.counter,
            active: this.active,
        };
    }

    get isExhausted() {
        return this.counter >= this.concurrency;
    }

    get active() {
        return this.pages.length;
    }
}
