'use strict';

const { test, expect } = require('@playwright/test');

function collectBrowserErrors(page) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') {
            errors.push(message.text());
        }
    });
    return errors;
}

test('demo template completes the QR workflow and exports a valid CUBE file', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    await page.goto('/index.html');

    const preset = page.locator('#color-preset-select');
    await expect(preset.locator('option[value="demo3x3"]')).toHaveText('Demo 3×3');
    await preset.selectOption('demo3x3');
    await page.getByRole('button', { name: 'Apply Preset' }).click();
    await expect(page.locator('#reference-grid .color-cell')).toHaveCount(9);

    await page.getByRole('button', { name: 'Continue to Reference Colors' }).click();
    await page.getByRole('button', { name: 'Continue to Color Card' }).click();
    await page.getByRole('button', { name: 'Use Demo Image' }).click();
    await expect(page.locator('#colorcard-info')).toContainText('Image loaded:');
    await expect(page.locator('#colorcard-next')).toBeEnabled();
    await expect(page.locator('#sampling-method')).toHaveValue('histogram');
    await expect(page.locator('#alignment-toggle')).not.toBeChecked();

    await page.locator('#sampling-method').selectOption('cluster');
    await page.locator('#alignment-toggle').check();
    await expect(page.locator('#alignment-controls')).toBeVisible();
    await page.locator('#alignment-toggle').uncheck();

    await page.locator('#colorcard-next').click();
    await expect(page.locator('#regression-solver')).toHaveValue('notebook');
    await expect(page.locator('#weighted-regression-toggle')).not.toBeChecked();
    await page.locator('#regression-solver').selectOption('qr');
    await page.locator('#process-button').click();
    await expect(page.locator('#quality-report')).toBeVisible();
    await expect(page.locator('#quality-summary')).toContainText('Mean ΔE76');
    await expect(page.locator('#process-next')).toBeEnabled();

    await page.locator('#process-next').click();
    await page.getByRole('button', { name: 'Use Demo Test Image' }).click();
    await expect(page.locator('#test-next')).toBeEnabled();
    await expect(page.locator('#process-log')).toContainText('Test image processing complete');
    await page.locator('#test-next').click();

    await page.locator('#lut-format').selectOption('cube');
    await expect(page.locator('#cube-size-control')).toBeVisible();
    await expect(page.locator('#cube-title-control')).toBeVisible();
    await page.locator('#lut-size-select').selectOption('17');
    await page.locator('#cube-title').fill('Demo Camera');
    await page.locator('#generate-lut').click();
    await expect(page.locator('#lut-download-container')).toBeVisible({ timeout: 60_000 });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#download-lut').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('demo-camera.cube');
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    const cube = Buffer.concat(chunks).toString('utf8');
    expect(cube).toContain('TITLE "Demo Camera"');
    expect(cube).toContain('LUT_3D_SIZE 17');
    expect(cube).toContain('DOMAIN_MIN 0.000000 0.000000 0.000000');
    expect(cube.split('\n').filter(line => /^\d/.test(line))).toHaveLength(17 ** 3);

    await page.locator('#lut-format').selectOption('png');
    await expect(page.locator('#cube-size-control')).toBeHidden();
    await page.locator('#generate-lut').click();
    await expect(page.locator('#lut-download-container')).toBeVisible({ timeout: 60_000 });
    const pngDownloadPromise = page.waitForEvent('download');
    await page.locator('#download-lut').click();
    const pngDownload = await pngDownloadPromise;
    expect(pngDownload.suggestedFilename()).toBe('custom-lut.png');
    const pngStream = await pngDownload.createReadStream();
    const pngChunks = [];
    for await (const chunk of pngStream) {
        pngChunks.push(chunk);
    }
    const png = Buffer.concat(pngChunks);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(png.readUInt32BE(16)).toBe(512);
    expect(png.readUInt32BE(20)).toBe(512);
    expect(browserErrors).toEqual([]);
});

test('JSON templates validate before changing the grid', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    await page.goto('/index.html');

    await page.locator('#import-template-input').setInputFiles({
        name: 'two-by-two.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({
            version: 2,
            rows: 2,
            columns: 2,
            cellBorderPercentage: 20,
            referenceColors: [[0, 0, 0], [255, 0, 0], [0, 255, 0], [255, 255, 255]],
            samplingMethod: 'median',
            useChartAlignment: false,
            chartCorners: [[0.03, 0.03], [0.97, 0.03], [0.97, 0.97], [0.03, 0.97]]
        }))
    });
    await expect(page.locator('#reference-grid .color-cell')).toHaveCount(4);
    await expect(page.locator('#rows-value')).toHaveText('2');
    await expect(page.locator('#columns-value')).toHaveText('2');
    await expect(page.locator('#sampling-method')).toHaveValue('median');

    const templateDownloadPromise = page.waitForEvent('download');
    await page.locator('#export-template-button').click();
    const templateDownload = await templateDownloadPromise;
    expect(templateDownload.suggestedFilename()).toBe('lut-maker-template.json');
    const templateStream = await templateDownload.createReadStream();
    const templateChunks = [];
    for await (const chunk of templateStream) {
        templateChunks.push(chunk);
    }
    const exportedTemplate = JSON.parse(Buffer.concat(templateChunks).toString('utf8'));
    expect(exportedTemplate).toMatchObject({ rows: 2, columns: 2, samplingMethod: 'median' });

    await page.locator('#import-template-input').setInputFiles({
        name: 'invalid.json',
        mimeType: 'application/json',
        buffer: Buffer.from('{"rows": 99}')
    });
    await expect(page.locator('#process-log')).toContainText('Template import failed');
    await expect(page.locator('#reference-grid .color-cell')).toHaveCount(4);
    expect(browserErrors).toEqual([]);
});

test('setup and template controls remain usable on a phone-sized viewport', async ({ page }) => {
    const browserErrors = collectBrowserErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/index.html');

    await expect(page.locator('#color-preset-select')).toBeVisible();
    await expect(page.locator('#apply-preset-button')).toBeVisible();
    const layout = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        importInputWidth: document.querySelector('#import-template-input').getBoundingClientRect().width,
        duplicateIds: [...document.querySelectorAll('[id]')]
            .map(element => element.id)
            .filter((id, index, ids) => ids.indexOf(id) !== index),
        visibleActionWidths: [...document.querySelectorAll('.template-actions button, .template-actions .file-button')]
            .map(element => Math.round(element.getBoundingClientRect().width))
    }));
    expect(layout.scrollWidth).toBe(layout.clientWidth);
    expect(layout.importInputWidth).toBeLessThanOrEqual(1);
    expect(layout.duplicateIds).toEqual([]);
    expect(layout.visibleActionWidths.every(width => width > 250 && width <= layout.clientWidth)).toBe(true);
    expect(browserErrors).toEqual([]);
});
