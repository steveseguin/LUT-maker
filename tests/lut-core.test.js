'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LUTCore = require('../lut-core.js');

const capturedDemoColors = [
    [110, 126, 116], [116, 96, 107], [102, 132, 142],
    [88, 94, 118], [99, 107, 120], [133, 132, 101],
    [84, 90, 102], [145, 152, 160], [114, 108, 132]
];

const referenceDemoColors = [
    [147, 163, 96], [154, 64, 73], [0, 166, 153],
    [61, 65, 93], [96, 102, 102], [247, 185, 48],
    [62, 63, 64], [245, 243, 236], [138, 83, 129]
];

function assertClose(actual, expected, tolerance = 1e-8, label = 'value') {
    assert.equal(actual.length, expected.length, `${label} length`);
    for (let index = 0; index < actual.length; index++) {
        assert.ok(
            Math.abs(actual[index] - expected[index]) <= tolerance,
            `${label}[${index}] expected ${expected[index]}, received ${actual[index]}`
        );
    }
}

function identityModels() {
    const colors = [
        [0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255],
        [255, 255, 0], [255, 0, 255], [0, 255, 255], [255, 255, 255],
        [64, 96, 128], [192, 160, 32]
    ];
    return LUTCore.buildTransformationModels(colors, colors, {
        polynomialDegree: 1,
        multivariateDegree: 2,
        useWeightedRegression: false
    });
}

test('neutral LUT fallback exactly matches the 64-step OBS layout', () => {
    const expectedSteps = [
        0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 45, 49, 53, 57, 61,
        65, 69, 73, 77, 81, 85, 89, 93, 97, 101, 105, 109, 113, 117, 121, 125,
        130, 134, 138, 142, 146, 150, 154, 158, 162, 166, 170, 174, 178, 182,
        186, 190, 194, 198, 202, 206, 210, 215, 219, 223, 227, 231, 235, 239,
        243, 247, 251, 255
    ];

    assert.deepEqual(Array.from({ length: 64 }, (_, index) => LUTCore.neutralLutValue(index)), expectedSteps);
    assert.deepEqual(LUTCore.neutralLutRgbAt(0, 0), [0, 0, 0]);
    assert.deepEqual(LUTCore.neutralLutRgbAt(63, 63), [255, 255, 0]);
    assert.deepEqual(LUTCore.neutralLutRgbAt(64, 0), [0, 0, 4]);
    assert.deepEqual(LUTCore.neutralLutRgbAt(511, 511), [255, 255, 255]);
});

test('cell bounds reproduce the notebook slicing calculation', () => {
    assert.deepEqual(
        LUTCore.calculateCellBounds(593, 447, 3, 3, 25, 2, 2),
        { x: 420, y: 316, width: 148, height: 112 }
    );
});

test('rolloff tables and edge mappings match the corrected notebook', () => {
    const curves = LUTCore.generateRolloffCurves();
    assert.equal(curves.highlight.length, 492);
    assert.equal(curves.shadow.length, 492);
    assert.deepEqual(
        [0, 1, 10, 20, 29, 30, 267, 491].map(index => curves.highlight[index]),
        [225, 230, 242, 249, 254, 255, 255, 255]
    );
    assert.deepEqual(
        [461, 462, 466, 476, 486, 490, 491].map(index => curves.shadow[index]),
        [0, 0, 1, 8, 21, 28, 30]
    );
    assert.deepEqual(
        [226, 230, 240, 250, 255, 300, 30, 25, 15, 5, 0, -10]
            .map(value => LUTCore.applyRolloff(value, curves)),
        [230, 237, 246, 252, 255, 255, 30, 21, 8, 1, 0, 0]
    );
});

test('unweighted demo coefficients match the NumPy notebook', () => {
    const models = LUTCore.buildTransformationModels(capturedDemoColors, referenceDemoColors, {
        polynomialDegree: 1,
        multivariateDegree: 2,
        useWeightedRegression: false
    });

    assertClose(models.basic.red, [-277.39445659073283, 3.6796671133366248], 1e-8, 'basic red');
    assertClose(models.basic.green, [-223.60582727608718, 3.034187507699889], 1e-8, 'basic green');
    assertClose(models.basic.blue, [-239.042183083279, 2.8646444879321593], 1e-8, 'basic blue');
    assertClose(models.multivariate.red.coefficients, [
        -270.2627712063, -0.03589600096461, -0.02435833496494, 0.000014093638233,
        3.670860809783, 0.00003835922404148, 0.0000429501939836, -4.22363726285e-8
    ], 1e-8, 'advanced red');
});

test('model fitting rejects malformed RGB samples before regression', () => {
    assert.throws(
        () => LUTCore.buildTransformationModels([[0, 0, Number.NaN]], [[0, 0, 0]]),
        /Captured colors must contain finite RGB values/
    );
    assert.throws(
        () => LUTCore.buildTransformationModels([[0, 0, 0]], [[0, 0, 300]]),
        /Reference colors must contain finite RGB values/
    );
});

test('weighted demo coefficients match both notebook weighting stages', () => {
    const models = LUTCore.buildTransformationModels(capturedDemoColors, referenceDemoColors, {
        polynomialDegree: 1,
        multivariateDegree: 2,
        useWeightedRegression: true
    });

    assertClose(models.basic.red, [-209.0644385, 3.16687204], 1e-7, 'weighted basic red');
    assertClose(models.basic.green, [-210.27144857, 2.96174742], 1e-7, 'weighted basic green');
    assertClose(models.basic.blue, [-241.71337339, 2.92145155], 1e-7, 'weighted basic blue');
    assertClose(models.multivariate.red.coefficients, [
        -209.13990636, -0.017736697839, -0.000489012275, 0.000000952713495,
        3.1717935427, 0.000012127766128, 0.000005632983213, 0.000000058927664
    ], 1e-7, 'weighted advanced red');
});

test('opt-in QR solver agrees with the notebook solver on a well-conditioned chart', () => {
    const notebookModels = LUTCore.buildTransformationModels(capturedDemoColors, referenceDemoColors, {
        polynomialDegree: 1,
        multivariateDegree: 2,
        useWeightedRegression: true,
        regressionSolver: 'notebook'
    });
    const qrModels = LUTCore.buildTransformationModels(capturedDemoColors, referenceDemoColors, {
        polynomialDegree: 1,
        multivariateDegree: 2,
        useWeightedRegression: true,
        regressionSolver: 'qr'
    });

    assert.equal(qrModels.metadata.regressionSolver, 'qr');
    for (const channel of ['red', 'green', 'blue']) {
        assertClose(qrModels.basic[channel], notebookModels.basic[channel], 1e-7, `QR basic ${channel}`);
        assertClose(
            qrModels.multivariate[channel].coefficients,
            notebookModels.multivariate[channel].coefficients,
            1e-7,
            `QR advanced ${channel}`
        );
    }
});

test('degree-two basic fitting matches NumPy at the notebook maximum', () => {
    const unweighted = LUTCore.buildTransformationModels(capturedDemoColors, referenceDemoColors, {
        polynomialDegree: 2,
        multivariateDegree: 2,
        useWeightedRegression: false
    });
    const weighted = LUTCore.buildTransformationModels(capturedDemoColors, referenceDemoColors, {
        polynomialDegree: 2,
        multivariateDegree: 2,
        useWeightedRegression: true
    });

    assertClose(unweighted.basic.red, [
        11.896217287188088, -1.5445322425819716, 0.022922798379047492
    ], 1e-8, 'degree-two red');
    assertClose(weighted.basic.red, [
        -209.1647667350309, 3.164873310574455, 0.0000172261183945996
    ], 1e-8, 'weighted degree-two red');
});

test('identity calibration remains identity in basic and advanced modes', () => {
    const models = identityModels();
    const curves = LUTCore.generateRolloffCurves();

    for (const useAdvancedProcessing of [false, true]) {
        for (const color of [[0, 0, 0], [17, 89, 201], [64, 128, 192], [255, 255, 255]]) {
            const transformed = LUTCore.transformRgb(...color, {
                models,
                useAdvancedProcessing,
                applyRolloffCurves: false,
                rolloffCurves: curves,
                brightnessAdjustment: 0,
                gammaValue: 1,
                quantizeOutput: false
            });
            assertClose(transformed, color, 1e-8, `identity ${useAdvancedProcessing ? 'advanced' : 'basic'}`);
        }
    }
});

test('quality report is effectively perfect for an identity calibration', () => {
    const colors = [
        [0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255],
        [255, 255, 0], [255, 0, 255], [0, 255, 255], [255, 255, 255],
        [64, 96, 128], [192, 160, 32]
    ];
    const metrics = LUTCore.evaluateTransformationModels(colors, colors, identityModels());

    assert.ok(metrics.basic.meanDeltaE < 1e-10);
    assert.ok(metrics.advanced.meanDeltaE < 1e-10);
    assert.equal(metrics.basic.clippedPercent, 0);
    assert.equal(metrics.basic.swatches.length, colors.length);
});

test('sRGB-to-Lab conversion matches standard D65 reference values', () => {
    assertClose(LUTCore.rgbToLab([255, 0, 0]), [53.2408, 80.0925, 67.2032], 0.001, 'red Lab');
    assert.ok(Math.abs(LUTCore.deltaE76([0, 0, 0], [255, 255, 255]) - 100) < 0.001);
});

test('perspective alignment maps every unit-square corner and rejects folded grids', () => {
    const corners = [[0.1, 0.2], [0.9, 0.1], [0.8, 0.9], [0.2, 0.8]];
    const homography = LUTCore.calculateUnitSquareHomography(corners);
    const unitCorners = [[0, 0], [1, 0], [1, 1], [0, 1]];

    unitCorners.forEach((point, index) => {
        assertClose(LUTCore.mapUnitSquarePoint(homography, ...point), corners[index], 1e-12, `corner ${index}`);
    });
    assert.throws(
        () => LUTCore.calculateUnitSquareHomography([[0, 0], [1, 1], [1, 0], [0, 1]]),
        /convex quadrilateral/
    );
});

test('grid extraction supports notebook-compatible and opt-in robust sampling', () => {
    const width = 8;
    const height = 8;
    const data = new Uint8ClampedArray(width * height * 4);
    const expected = [[20, 30, 40], [80, 90, 100], [140, 150, 160], [200, 210, 220]];
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const cell = Math.floor(y / 4) * 2 + Math.floor(x / 4);
            const offset = (y * width + x) * 4;
            data.set([...expected[cell], 255], offset);
        }
    }
    // One bright outlier in the first patch should be ignored by the robust mode.
    data.set([255, 255, 255, 255], 0);
    const imageData = { data, width, height };
    const baseOptions = { rows: 2, columns: 2, borderPercentage: 0 };

    assert.deepEqual(
        LUTCore.extractGridColors(imageData, { ...baseOptions, method: 'histogram' }),
        expected
    );
    assert.deepEqual(
        LUTCore.extractGridColors(imageData, { ...baseOptions, method: 'cluster' }),
        expected
    );
    assert.deepEqual(
        LUTCore.extractGridColors(imageData, {
            ...baseOptions,
            method: 'median',
            useAlignment: true,
            corners: [[0, 0], [1, 0], [1, 1], [0, 1]]
        }),
        expected
    );
});

test('one pipeline applies brightness, rolloff, gamma, and output quantization', () => {
    const models = identityModels();
    const curves = LUTCore.generateRolloffCurves();
    const baseOptions = {
        models,
        useAdvancedProcessing: true,
        applyRolloffCurves: true,
        rolloffCurves: curves,
        brightnessAdjustment: 0,
        gammaValue: 1,
        quantizeOutput: false
    };

    assertClose(LUTCore.transformRgb(226, 15, 128, baseOptions), [230, 8, 128], 1e-8);

    const gammaAdjusted = LUTCore.transformRgb(226, 15, 128, { ...baseOptions, gammaValue: 2 });
    assert.ok(gammaAdjusted[0] > 230);
    assert.ok(gammaAdjusted[1] > 8);

    const quantized = LUTCore.transformRgb(100.9, 120.9, 140.9, {
        ...baseOptions,
        applyRolloffCurves: false,
        quantizeOutput: true
    });
    assert.deepEqual(quantized, [100, 120, 140]);
});

test('CUBE export keeps floating-point precision and red-fastest ordering', () => {
    const models = {
        basic: {
            red: [0.1, 0.91],
            green: [0.2, 0.87],
            blue: [0.3, 0.83]
        },
        multivariate: { red: null, green: null, blue: null }
    };
    const cube = LUTCore.generateCubeData(3, {
        models,
        useAdvancedProcessing: false,
        applyRolloffCurves: false,
        rolloffCurves: LUTCore.generateRolloffCurves(),
        brightnessAdjustment: 0,
        gammaValue: 1
    });
    const rows = cube.split('\n').filter(line => /^\d/.test(line));

    assert.match(cube, /LUT_3D_SIZE 3/);
    assert.equal(rows.length, 27);
    assert.equal(rows[0], '0.000392 0.000784 0.001176');
    assert.notEqual(rows[0], rows[1], 'red must change fastest');

    const values = rows.flatMap(row => row.split(' ').map(Number));
    assert.ok(values.some(value => Math.abs(value * 255 - Math.round(value * 255)) > 0.001));
});

test('CUBE export includes sanitized title and standard domain metadata', () => {
    const cube = LUTCore.generateCubeData(2, {
        models: identityModels(),
        useAdvancedProcessing: false,
        applyRolloffCurves: false,
        brightnessAdjustment: 0,
        gammaValue: 1
    }, undefined, { title: 'Camera "A"\nStudio' });

    assert.match(cube, /TITLE "Camera 'A' Studio"/);
    assert.match(cube, /DOMAIN_MIN 0\.000000 0\.000000 0\.000000/);
    assert.match(cube, /DOMAIN_MAX 1\.000000 1\.000000 1\.000000/);
});

test('CUBE export honors the same rolloff and gamma settings as previews and PNGs', () => {
    const models = identityModels();
    const baseOptions = {
        models,
        useAdvancedProcessing: true,
        applyRolloffCurves: true,
        rolloffCurves: LUTCore.generateRolloffCurves(),
        brightnessAdjustment: 10,
        gammaValue: 1
    };

    const baseline = LUTCore.generateCubeData(8, baseOptions);
    const noRolloff = LUTCore.generateCubeData(8, {
        ...baseOptions,
        applyRolloffCurves: false
    });
    const gammaAdjusted = LUTCore.generateCubeData(8, {
        ...baseOptions,
        gammaValue: 2
    });

    assert.notEqual(baseline, noRolloff);
    assert.notEqual(baseline, gammaAdjusted);
});
