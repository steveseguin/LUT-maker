'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function createApp() {
    const images = [];
    const displayed = [];
    const revoked = [];
    const messages = [];
    const requests = [];
    const context = vm.createContext({
        document: { addEventListener() {} },
        Image: class {
            constructor() {
                this.width = 24;
                this.height = 24;
                images.push(this);
            }
        },
        File: class {
            constructor(parts, name, options) {
                this.name = name;
                this.type = options.type;
                this.size = 1;
            }
        },
        URL: {
            createObjectURL: file => `blob:${file.name}`,
            revokeObjectURL: url => revoked.push(url)
        },
        fetch: url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })),
        setTimeout,
        clearTimeout,
        displayed,
        messages
    });
    vm.runInContext(readFileSync(path.join(__dirname, '../app.js'), 'utf8'), context);
    vm.runInContext(`
        displayColorCardImage = image => displayed.push(['colorcard', image]);
        displayTestImage = image => displayed.push(['test', image]);
        logMessage = (message, type) => messages.push([message, type]);
    `, context);
    return { context, images, displayed, revoked, messages, requests };
}

const imageFile = name => ({ name, type: 'image/png', size: 1 });
const settle = () => new Promise(resolve => setImmediate(resolve));

for (const type of ['colorcard', 'test']) {
    test(`the latest ${type} selection wins when decoding finishes out of order`, () => {
        const app = createApp();
        app.context.loadImage(imageFile('old.png'), type);
        app.context.loadImage(imageFile('new.png'), type);
        app.images[1].onload();
        app.images[0].onload();
        assert.equal(app.displayed.length, 1);
        assert.equal(app.displayed[0][1], app.images[1]);
        assert.deepEqual(app.revoked, ['blob:new.png', 'blob:old.png']);
    });
}

test('loading a test image does not cancel a color card image', () => {
    const app = createApp();
    app.context.loadImage(imageFile('card.png'), 'colorcard');
    app.context.loadImage(imageFile('test.png'), 'test');
    app.images[1].onload();
    app.images[0].onload();
    assert.equal(app.displayed.length, 2);
});

test('superseded image failures release their URL without reporting an error', () => {
    const app = createApp();
    app.context.loadImage(imageFile('old.png'), 'test');
    app.context.loadImage(imageFile('new.png'), 'test');
    app.images[1].onload();
    app.images[0].onerror();
    assert.equal(app.messages.filter(([, type]) => type === 'error').length, 0);
    assert.ok(app.revoked.includes('blob:old.png'));
});

test('a delayed demo download cannot replace a newer uploaded image', async () => {
    const app = createApp();
    app.context.loadDemoImage('colorcard');
    app.context.loadImage(imageFile('new.png'), 'colorcard');
    app.images[0].onload();
    app.requests[0].resolve({ ok: true, blob: async () => ({}) });
    await settle();
    assert.equal(app.images.length, 1);
    assert.equal(app.displayed.length, 1);
});

test('a newer demo request invalidates an image still being decoded', async () => {
    const app = createApp();
    app.context.loadImage(imageFile('old.png'), 'test');
    app.context.loadDemoImage('test');
    app.images[0].onload();
    assert.equal(app.displayed.length, 0);
    app.requests[0].resolve({ ok: true, blob: async () => ({}) });
    await settle();
    app.images[1].onload();
    assert.equal(app.displayed.length, 1);
    assert.equal(app.displayed[0][1], app.images[1]);
});

test('superseded demo failures do not report an error over the current image', async () => {
    const app = createApp();
    app.context.loadDemoImage('test');
    app.context.loadImage(imageFile('new.png'), 'test');
    app.images[0].onload();
    app.requests[0].reject(new Error('synthetic old request failure'));
    await settle();
    assert.equal(app.messages.filter(([, type]) => type === 'error').length, 0);
});
