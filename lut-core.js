(function (root, factory) {
    const api = factory();

    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.LUTCore = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const MIN_RGB = 0;
    const MAX_RGB = 255;
    const ROLLOFF_TABLE_SIZE = 492;

    function clamp(value, min = MIN_RGB, max = MAX_RGB) {
        return Math.min(max, Math.max(min, value));
    }

    function assertFiniteNumber(value, label) {
        if (!Number.isFinite(value)) {
            throw new Error(`${label} must be a finite number`);
        }
    }

    function roundHalfToEven(value) {
        assertFiniteNumber(value, 'Value');

        const floor = Math.floor(value);
        const fraction = value - floor;
        const tieTolerance = Number.EPSILON * Math.max(1, Math.abs(value)) * 2;

        if (Math.abs(fraction - 0.5) <= tieTolerance) {
            return floor % 2 === 0 ? floor : floor + 1;
        }

        return Math.round(value);
    }

    function standardDeviation(values) {
        if (!Array.isArray(values) || values.length === 0) {
            return 0;
        }

        const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        const variance = values.reduce((sum, value) => {
            const delta = value - mean;
            return sum + delta * delta;
        }, 0) / values.length;

        return Math.sqrt(variance);
    }

    function isNeutralColor(color) {
        if (!Array.isArray(color) || color.length < 3) {
            return false;
        }

        const [r, g, b] = color;
        return Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b)) < 20;
    }

    function calculateRobustWeights(colors, residuals) {
        const weights = residuals.map((_, index) => isNeutralColor(colors[index]) ? 2.0 : 1.0);
        const cutoff = 1.345 * standardDeviation(residuals);

        if (cutoff <= 0) {
            return weights;
        }

        for (let index = 0; index < residuals.length; index++) {
            const absoluteResidual = Math.abs(residuals[index]);
            if (absoluteResidual > cutoff) {
                weights[index] *= cutoff / absoluteResidual;
            }
        }

        return weights;
    }

    function solveLinearSystem(matrix, vector) {
        const size = matrix.length;
        const augmented = matrix.map((row, index) => [...row, vector[index]]);

        for (let column = 0; column < size; column++) {
            let pivotRow = column;
            for (let row = column + 1; row < size; row++) {
                if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivotRow][column])) {
                    pivotRow = row;
                }
            }

            const pivot = augmented[pivotRow][column];
            if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-12) {
                throw new Error('Regression data is singular; use more varied color samples or a lower polynomial degree');
            }

            if (pivotRow !== column) {
                [augmented[column], augmented[pivotRow]] = [augmented[pivotRow], augmented[column]];
            }

            for (let row = column + 1; row < size; row++) {
                const factor = augmented[row][column] / augmented[column][column];
                augmented[row][column] = 0;
                for (let entry = column + 1; entry <= size; entry++) {
                    augmented[row][entry] -= factor * augmented[column][entry];
                }
            }
        }

        const solution = new Array(size).fill(0);
        for (let row = size - 1; row >= 0; row--) {
            let remaining = augmented[row][size];
            for (let column = row + 1; column < size; column++) {
                remaining -= augmented[row][column] * solution[column];
            }
            solution[row] = remaining / augmented[row][row];
        }

        return solution;
    }

    function solveLeastSquaresNormal(designMatrix, targetValues, equationWeights) {
        if (!Array.isArray(designMatrix) || designMatrix.length === 0) {
            throw new Error('Regression requires at least one sample');
        }

        if (designMatrix.length !== targetValues.length) {
            throw new Error('Regression inputs and targets must have the same length');
        }

        const sampleCount = designMatrix.length;
        const termCount = designMatrix[0].length;
        const weights = equationWeights || new Array(sampleCount).fill(1.0);

        if (weights.length !== sampleCount) {
            throw new Error('Regression weights must match the sample count');
        }

        const columnScales = new Array(termCount).fill(0);
        for (let term = 0; term < termCount; term++) {
            let weightedMagnitude = 0;
            for (let sample = 0; sample < sampleCount; sample++) {
                const weight = weights[sample];
                if (!Number.isFinite(weight) || weight < 0) {
                    throw new Error('Regression weights must be finite and non-negative');
                }
                weightedMagnitude += weight * designMatrix[sample][term] * designMatrix[sample][term];
            }
            columnScales[term] = Math.sqrt(weightedMagnitude);
            if (!Number.isFinite(columnScales[term]) || columnScales[term] === 0) {
                throw new Error('Regression data does not contain enough variation');
            }
        }

        const normalMatrix = Array.from({ length: termCount }, () => new Array(termCount).fill(0));
        const normalTarget = new Array(termCount).fill(0);

        for (let left = 0; left < termCount; left++) {
            for (let sample = 0; sample < sampleCount; sample++) {
                const scaledLeft = designMatrix[sample][left] / columnScales[left];
                normalTarget[left] += weights[sample] * scaledLeft * targetValues[sample];
            }

            for (let right = left; right < termCount; right++) {
                let sum = 0;
                for (let sample = 0; sample < sampleCount; sample++) {
                    sum += weights[sample]
                        * (designMatrix[sample][left] / columnScales[left])
                        * (designMatrix[sample][right] / columnScales[right]);
                }
                normalMatrix[left][right] = sum;
                normalMatrix[right][left] = sum;
            }
        }

        const scaledCoefficients = solveLinearSystem(normalMatrix, normalTarget);
        return scaledCoefficients.map((coefficient, index) => coefficient / columnScales[index]);
    }

    function solveLeastSquaresQr(designMatrix, targetValues, equationWeights) {
        if (!Array.isArray(designMatrix) || designMatrix.length === 0) {
            throw new Error('Regression requires at least one sample');
        }
        if (designMatrix.length !== targetValues.length) {
            throw new Error('Regression inputs and targets must have the same length');
        }

        const sampleCount = designMatrix.length;
        const termCount = designMatrix[0].length;
        if (sampleCount < termCount) {
            throw new Error(`QR regression requires at least ${termCount} varied samples`);
        }
        if (designMatrix.some(row => !Array.isArray(row) || row.length !== termCount)) {
            throw new Error('Regression rows must contain the same number of terms');
        }

        const weights = equationWeights || new Array(sampleCount).fill(1.0);
        if (weights.length !== sampleCount) {
            throw new Error('Regression weights must match the sample count');
        }

        const columnScales = new Array(termCount).fill(0);
        for (let term = 0; term < termCount; term++) {
            let magnitude = 0;
            for (let sample = 0; sample < sampleCount; sample++) {
                const weight = weights[sample];
                if (!Number.isFinite(weight) || weight < 0) {
                    throw new Error('Regression weights must be finite and non-negative');
                }
                const value = designMatrix[sample][term];
                assertFiniteNumber(value, 'Regression term');
                magnitude += weight * value * value;
            }
            columnScales[term] = Math.sqrt(magnitude);
            if (!Number.isFinite(columnScales[term]) || columnScales[term] === 0) {
                throw new Error('Regression data does not contain enough variation');
            }
        }

        const matrix = designMatrix.map((row, sample) => {
            const weightScale = Math.sqrt(weights[sample]);
            return row.map((value, term) => weightScale * value / columnScales[term]);
        });
        const transformedTarget = targetValues.map((value, sample) => {
            assertFiniteNumber(value, 'Regression target');
            return Math.sqrt(weights[sample]) * value;
        });

        // Householder QR avoids the condition-number squaring caused by normal equations.
        for (let column = 0; column < termCount; column++) {
            let norm = 0;
            for (let row = column; row < sampleCount; row++) {
                norm = Math.hypot(norm, matrix[row][column]);
            }
            if (!Number.isFinite(norm) || norm < 1e-10) {
                throw new Error('Regression data is rank-deficient; use more varied samples or the notebook-compatible solver');
            }

            const alpha = matrix[column][column] >= 0 ? -norm : norm;
            const vector = [];
            for (let row = column; row < sampleCount; row++) {
                vector.push(matrix[row][column]);
            }
            vector[0] -= alpha;
            const vectorMagnitude = vector.reduce((sum, value) => sum + value * value, 0);
            if (vectorMagnitude < 1e-20) {
                throw new Error('Regression data is rank-deficient');
            }
            const beta = 2 / vectorMagnitude;

            for (let term = column; term < termCount; term++) {
                let projection = 0;
                for (let offset = 0; offset < vector.length; offset++) {
                    projection += vector[offset] * matrix[column + offset][term];
                }
                projection *= beta;
                for (let offset = 0; offset < vector.length; offset++) {
                    matrix[column + offset][term] -= projection * vector[offset];
                }
            }

            let targetProjection = 0;
            for (let offset = 0; offset < vector.length; offset++) {
                targetProjection += vector[offset] * transformedTarget[column + offset];
            }
            targetProjection *= beta;
            for (let offset = 0; offset < vector.length; offset++) {
                transformedTarget[column + offset] -= targetProjection * vector[offset];
            }

            matrix[column][column] = alpha;
            for (let row = column + 1; row < sampleCount; row++) {
                matrix[row][column] = 0;
            }
        }

        const scaledCoefficients = new Array(termCount).fill(0);
        for (let row = termCount - 1; row >= 0; row--) {
            let remaining = transformedTarget[row];
            for (let column = row + 1; column < termCount; column++) {
                remaining -= matrix[row][column] * scaledCoefficients[column];
            }
            if (Math.abs(matrix[row][row]) < 1e-10) {
                throw new Error('Regression data is rank-deficient');
            }
            scaledCoefficients[row] = remaining / matrix[row][row];
        }

        return scaledCoefficients.map((coefficient, index) => coefficient / columnScales[index]);
    }

    function solveLeastSquares(designMatrix, targetValues, equationWeights, solver = 'notebook') {
        if (solver === 'qr') {
            return solveLeastSquaresQr(designMatrix, targetValues, equationWeights);
        }
        if (solver !== 'notebook') {
            throw new Error(`Unknown regression solver: ${solver}`);
        }
        return solveLeastSquaresNormal(designMatrix, targetValues, equationWeights);
    }

    function buildPolynomialMatrix(values, degree) {
        if (!Number.isInteger(degree) || degree < 1) {
            throw new Error('Polynomial degree must be a positive integer');
        }

        return values.map(value => {
            const row = [];
            for (let exponent = 0; exponent <= degree; exponent++) {
                row.push(Math.pow(value, exponent));
            }
            return row;
        });
    }

    function applyPolynomial(value, coefficients) {
        if (!Array.isArray(coefficients)) {
            return value;
        }

        let result = 0;
        for (let exponent = 0; exponent < coefficients.length; exponent++) {
            result += coefficients[exponent] * Math.pow(value, exponent);
        }

        return Number.isFinite(result) ? result : value;
    }

    function fitPolynomial(values, targets, degree, equationWeights, solver) {
        return solveLeastSquares(buildPolynomialMatrix(values, degree), targets, equationWeights, solver);
    }

    function fitBasicChannel(capturedColors, values, targets, degree, useWeightedRegression, solver) {
        const initialCoefficients = fitPolynomial(values, targets, degree, undefined, solver);

        if (!useWeightedRegression) {
            return initialCoefficients;
        }

        const residuals = values.map((value, index) => targets[index] - applyPolynomial(value, initialCoefficients));
        const robustWeights = calculateRobustWeights(capturedColors, residuals);

        // numpy.polyfit applies its `w` argument to the unsquared residual.
        // Squaring here reproduces the notebook's final normal equations.
        const equationWeights = robustWeights.map(weight => weight * weight);
        return fitPolynomial(values, targets, degree, equationWeights, solver);
    }

    function buildMultivariateDegrees(degree) {
        const degrees = [];
        for (let redDegree = 0; redDegree < degree; redDegree++) {
            for (let greenDegree = 0; greenDegree < degree; greenDegree++) {
                for (let blueDegree = 0; blueDegree < degree; blueDegree++) {
                    degrees.push([redDegree, greenDegree, blueDegree]);
                }
            }
        }
        return degrees;
    }

    function buildMultivariateMatrix(colors, degrees) {
        return colors.map(([r, g, b]) => degrees.map(([redDegree, greenDegree, blueDegree]) => (
            Math.pow(r, redDegree) * Math.pow(g, greenDegree) * Math.pow(b, blueDegree)
        )));
    }

    function applyMultivariate(valueColor, model) {
        if (!model || !Array.isArray(model.coefficients) || !Array.isArray(model.degrees)) {
            throw new Error('A valid multivariate model is required');
        }

        const [r, g, b] = valueColor;
        let result = 0;
        for (let index = 0; index < model.coefficients.length; index++) {
            const [redDegree, greenDegree, blueDegree] = model.degrees[index];
            result += model.coefficients[index]
                * Math.pow(r, redDegree)
                * Math.pow(g, greenDegree)
                * Math.pow(b, blueDegree);
        }

        if (!Number.isFinite(result)) {
            throw new Error('Multivariate transformation produced an invalid value');
        }
        return result;
    }

    function fitMultivariateChannel(colors, targets, degree, useWeightedRegression, solver) {
        const degrees = buildMultivariateDegrees(degree);
        const designMatrix = buildMultivariateMatrix(colors, degrees);
        const initialCoefficients = solveLeastSquares(designMatrix, targets, undefined, solver);

        if (!useWeightedRegression) {
            return { coefficients: initialCoefficients, degrees };
        }

        const residuals = colors.map((_, index) => {
            let prediction = 0;
            for (let term = 0; term < initialCoefficients.length; term++) {
                prediction += designMatrix[index][term] * initialCoefficients[term];
            }
            return targets[index] - prediction;
        });
        const equationWeights = calculateRobustWeights(colors, residuals);

        return {
            coefficients: solveLeastSquares(designMatrix, targets, equationWeights, solver),
            degrees
        };
    }

    function buildTransformationModels(capturedColors, referenceColors, options = {}) {
        if (!Array.isArray(capturedColors) || !Array.isArray(referenceColors)
                || capturedColors.length !== referenceColors.length || capturedColors.length === 0) {
            throw new Error('Captured and reference color arrays must be non-empty and the same length');
        }

        for (const [label, colors] of [['Captured', capturedColors], ['Reference', referenceColors]]) {
            if (colors.some(color => !Array.isArray(color) || color.length < 3
                    || color.slice(0, 3).some(value => !Number.isFinite(value) || value < 0 || value > 255))) {
                throw new Error(`${label} colors must contain finite RGB values from 0 to 255`);
            }
        }

        const polynomialDegree = options.polynomialDegree ?? 1;
        const multivariateDegree = options.multivariateDegree ?? 2;
        const useWeightedRegression = Boolean(options.useWeightedRegression);
        const regressionSolver = options.regressionSolver || 'notebook';
        const channelNames = ['red', 'green', 'blue'];
        const basic = {};

        for (let channel = 0; channel < 3; channel++) {
            basic[channelNames[channel]] = fitBasicChannel(
                capturedColors,
                capturedColors.map(color => color[channel]),
                referenceColors.map(color => color[channel]),
                polynomialDegree,
                useWeightedRegression,
                regressionSolver
            );
        }

        const cornerValues = [0, 255];
        const cornerColors = [];
        for (const r of cornerValues) {
            for (const g of cornerValues) {
                for (const b of cornerValues) {
                    cornerColors.push([r, g, b]);
                }
            }
        }

        const transformedCorners = cornerColors.map(([r, g, b]) => [
            applyPolynomial(r, basic.red),
            applyPolynomial(g, basic.green),
            applyPolynomial(b, basic.blue)
        ]);
        const trainingColors = [...capturedColors, ...cornerColors];
        const trainingTargets = [...referenceColors, ...transformedCorners];
        const multivariate = {};

        for (let channel = 0; channel < 3; channel++) {
            multivariate[channelNames[channel]] = fitMultivariateChannel(
                trainingColors,
                trainingTargets.map(color => color[channel]),
                multivariateDegree,
                useWeightedRegression,
                regressionSolver
            );
        }

        return {
            basic,
            multivariate,
            metadata: {
                polynomialDegree,
                multivariateDegree,
                useWeightedRegression,
                regressionSolver,
                sampleCount: capturedColors.length
            }
        };
    }

    function hasCompleteMultivariateModel(models) {
        return Boolean(models && models.multivariate
            && models.multivariate.red && models.multivariate.green && models.multivariate.blue);
    }

    function predictRgb(r, g, b, models, useAdvancedProcessing) {
        if (!models || !models.basic) {
            throw new Error('A fitted color model is required');
        }

        if (Boolean(useAdvancedProcessing) && hasCompleteMultivariateModel(models)) {
            const inputColor = [r, g, b];
            return [
                applyMultivariate(inputColor, models.multivariate.red),
                applyMultivariate(inputColor, models.multivariate.green),
                applyMultivariate(inputColor, models.multivariate.blue)
            ];
        }

        return [
            applyPolynomial(r, models.basic.red),
            applyPolynomial(g, models.basic.green),
            applyPolynomial(b, models.basic.blue)
        ];
    }

    function srgbChannelToLinear(value) {
        const normalized = clamp(value) / 255;
        return normalized <= 0.04045
            ? normalized / 12.92
            : Math.pow((normalized + 0.055) / 1.055, 2.4);
    }

    function rgbToLab(color) {
        const red = srgbChannelToLinear(color[0]);
        const green = srgbChannelToLinear(color[1]);
        const blue = srgbChannelToLinear(color[2]);
        const x = (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) / 0.95047;
        const y = red * 0.2126729 + green * 0.7151522 + blue * 0.072175;
        const z = (red * 0.0193339 + green * 0.119192 + blue * 0.9503041) / 1.08883;
        const convert = value => value > 0.008856
            ? Math.cbrt(value)
            : 7.787 * value + 16 / 116;
        const fx = convert(x);
        const fy = convert(y);
        const fz = convert(z);
        return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
    }

    function deltaE76(firstColor, secondColor) {
        const firstLab = rgbToLab(firstColor);
        const secondLab = rgbToLab(secondColor);
        return Math.hypot(
            firstLab[0] - secondLab[0],
            firstLab[1] - secondLab[1],
            firstLab[2] - secondLab[2]
        );
    }

    function evaluateModel(capturedColors, referenceColors, models, useAdvancedProcessing) {
        const channelSquares = [0, 0, 0];
        let clippedChannels = 0;
        let deltaESum = 0;
        let maxDeltaE = 0;

        const swatches = capturedColors.map((captured, index) => {
            const predicted = predictRgb(
                captured[0],
                captured[1],
                captured[2],
                models,
                useAdvancedProcessing
            );
            const target = referenceColors[index];
            const channelErrors = predicted.map((value, channel) => {
                const error = value - target[channel];
                channelSquares[channel] += error * error;
                if (value < 0 || value > 255) {
                    clippedChannels++;
                }
                return error;
            });
            const colorDifference = deltaE76(predicted.map(value => clamp(value)), target);
            deltaESum += colorDifference;
            maxDeltaE = Math.max(maxDeltaE, colorDifference);

            return {
                index,
                captured: captured.slice(0, 3),
                target: target.slice(0, 3),
                predicted,
                channelErrors,
                rgbError: Math.hypot(...channelErrors),
                deltaE: colorDifference,
                clipped: predicted.some(value => value < 0 || value > 255)
            };
        });

        const channelRmse = channelSquares.map(sum => Math.sqrt(sum / capturedColors.length));
        return {
            mode: useAdvancedProcessing ? 'advanced' : 'basic',
            channelRmse,
            rgbRmse: Math.sqrt(channelSquares.reduce((sum, value) => sum + value, 0) / (capturedColors.length * 3)),
            meanDeltaE: deltaESum / capturedColors.length,
            maxDeltaE,
            clippedPercent: clippedChannels / (capturedColors.length * 3) * 100,
            swatches
        };
    }

    function evaluateTransformationModels(capturedColors, referenceColors, models) {
        if (!Array.isArray(capturedColors) || !Array.isArray(referenceColors)
                || capturedColors.length === 0 || capturedColors.length !== referenceColors.length) {
            throw new Error('Quality evaluation requires matching captured and reference colors');
        }

        const basic = evaluateModel(capturedColors, referenceColors, models, false);
        const advanced = hasCompleteMultivariateModel(models)
            ? evaluateModel(capturedColors, referenceColors, models, true)
            : null;
        const recommendedMode = advanced && advanced.meanDeltaE < basic.meanDeltaE ? 'advanced' : 'basic';

        return { basic, advanced, recommendedMode };
    }

    function generateRolloffCurves() {
        const highlight = new Array(ROLLOFF_TABLE_SIZE).fill(255);
        const shadow = new Array(ROLLOFF_TABLE_SIZE).fill(0);

        for (let index = 0; index < 267; index++) {
            const inputValue = index + 225;
            const outputValue = inputValue <= 255
                ? 225 + 30 * Math.sqrt((inputValue - 225) / 30)
                : 255;
            highlight[index] = roundHalfToEven(outputValue);
        }

        for (let index = 0; index < ROLLOFF_TABLE_SIZE; index++) {
            const inputValue = index - 461;
            let outputValue;
            if (inputValue < 0) {
                outputValue = 0;
            } else if (inputValue <= 30) {
                outputValue = 30 * Math.pow(inputValue / 30, 2);
            } else {
                outputValue = Math.min(inputValue, 255);
            }
            shadow[index] = roundHalfToEven(outputValue);
        }

        return { highlight, shadow };
    }

    function applyRolloff(value, curves) {
        if (!Number.isFinite(value)) {
            return 0;
        }

        if (!curves || !Array.isArray(curves.highlight) || !Array.isArray(curves.shadow)) {
            throw new Error('Valid highlight and shadow rolloff curves are required');
        }

        if (value > 225 && value < 492) {
            return curves.highlight[roundHalfToEven(value - 225)];
        }
        if (value >= 492) {
            return 255;
        }
        if (value <= 30 && value > -461) {
            return curves.shadow[roundHalfToEven(value + 461)];
        }
        if (value <= -461) {
            return 0;
        }

        return value;
    }

    function applyGamma(value, gamma) {
        assertFiniteNumber(gamma, 'Gamma');
        if (gamma <= 0) {
            throw new Error('Gamma must be greater than zero');
        }
        return Math.pow(clamp(value) / 255, 1 / gamma) * 255;
    }

    function toUint8(value) {
        return Math.trunc(clamp(value));
    }

    function transformRgb(r, g, b, options) {
        if (!options || !options.models || !options.models.basic) {
            throw new Error('A fitted color model is required');
        }

        const models = options.models;
        let transformed = predictRgb(r, g, b, models, options.useAdvancedProcessing);

        const brightness = Number.isFinite(options.brightnessAdjustment) ? options.brightnessAdjustment : 0;
        transformed = transformed.map(value => value + brightness);

        if (options.applyRolloffCurves) {
            transformed = transformed.map(value => applyRolloff(value, options.rolloffCurves));
        }

        transformed = transformed.map(value => clamp(value));

        const gamma = Number.isFinite(options.gammaValue) ? options.gammaValue : 1.0;
        if (gamma !== 1.0) {
            transformed = transformed.map(value => applyGamma(value, gamma));
        }

        transformed = transformed.map(value => clamp(value));
        return options.quantizeOutput ? transformed.map(toUint8) : transformed;
    }

    function neutralLutValue(step) {
        if (!Number.isInteger(step) || step < 0 || step > 63) {
            throw new Error('Neutral LUT step must be an integer from 0 to 63');
        }
        return Math.round(step * 255 / 63);
    }

    function neutralLutRgbAt(x, y) {
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= 512 || y < 0 || y >= 512) {
            throw new Error('Neutral LUT coordinates must be within a 512x512 image');
        }

        const blockIndex = Math.floor(y / 64) * 8 + Math.floor(x / 64);
        return [
            neutralLutValue(x % 64),
            neutralLutValue(y % 64),
            neutralLutValue(blockIndex)
        ];
    }

    function calculateCellBounds(imageWidth, imageHeight, rows, columns, borderPercentage, row, column) {
        const cellWidth = imageWidth / columns;
        const cellHeight = imageHeight / rows;
        const borderX = (borderPercentage / 200) * cellWidth;
        const borderY = (borderPercentage / 200) * cellHeight;
        const x = Math.floor(column * cellWidth + borderX);
        const y = Math.floor(row * cellHeight + borderY);
        const endX = Math.floor((column + 1) * cellWidth - borderX);
        const endY = Math.floor((row + 1) * cellHeight - borderY);

        return { x, y, width: endX - x, height: endY - y };
    }

    function validateCorners(corners) {
        if (!Array.isArray(corners) || corners.length !== 4
                || corners.some(point => !Array.isArray(point) || point.length < 2
                    || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
                    || point[0] < 0 || point[0] > 1 || point[1] < 0 || point[1] > 1)) {
            throw new Error('Alignment requires four valid corner points');
        }

        const turns = corners.map((point, index) => {
            const next = corners[(index + 1) % corners.length];
            const afterNext = corners[(index + 2) % corners.length];
            return (next[0] - point[0]) * (afterNext[1] - next[1])
                - (next[1] - point[1]) * (afterNext[0] - next[0]);
        });
        const hasPositiveTurn = turns.some(value => value > 1e-8);
        const hasNegativeTurn = turns.some(value => value < -1e-8);
        if (turns.some(value => Math.abs(value) <= 1e-8) || (hasPositiveTurn && hasNegativeTurn)) {
            throw new Error('Alignment corners must form a non-self-intersecting convex quadrilateral');
        }
    }

    function calculateUnitSquareHomography(corners) {
        validateCorners(corners);
        const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = corners;
        const dx1 = x1 - x2;
        const dx2 = x3 - x2;
        const dy1 = y1 - y2;
        const dy2 = y3 - y2;
        const sx = x0 - x1 + x2 - x3;
        const sy = y0 - y1 + y2 - y3;

        let g = 0;
        let h = 0;
        if (Math.abs(sx) > 1e-12 || Math.abs(sy) > 1e-12) {
            const denominator = dx1 * dy2 - dx2 * dy1;
            if (Math.abs(denominator) < 1e-12) {
                throw new Error('Alignment corners form a degenerate quadrilateral');
            }
            g = (sx * dy2 - dx2 * sy) / denominator;
            h = (dx1 * sy - sx * dy1) / denominator;
        }

        return {
            a: x1 - x0 + g * x1,
            b: x3 - x0 + h * x3,
            c: x0,
            d: y1 - y0 + g * y1,
            e: y3 - y0 + h * y3,
            f: y0,
            g,
            h
        };
    }

    function mapUnitSquarePoint(homography, u, v) {
        const denominator = homography.g * u + homography.h * v + 1;
        if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) {
            throw new Error('Alignment mapping produced an invalid point');
        }
        return [
            (homography.a * u + homography.b * v + homography.c) / denominator,
            (homography.d * u + homography.e * v + homography.f) / denominator
        ];
    }

    function median(values) {
        if (!values.length) {
            return 0;
        }
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2
            ? sorted[middle]
            : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    function summarizePixels(pixels, method = 'histogram') {
        if (!Array.isArray(pixels) || pixels.length === 0) {
            throw new Error('A color cell did not contain any usable pixels');
        }
        if (!['histogram', 'median', 'trimmed', 'cluster'].includes(method)) {
            throw new Error(`Unknown color sampling method: ${method}`);
        }

        const channels = [0, 1, 2].map(channel => pixels.map(pixel => pixel[channel]));
        if (method === 'histogram') {
            return channels.map(values => {
                const histogram = new Array(256).fill(0);
                values.forEach(value => histogram[Math.round(clamp(value))]++);
                return histogram.indexOf(Math.max(...histogram));
            });
        }
        if (method === 'median') {
            return channels.map(values => Math.round(median(values)));
        }
        if (method === 'trimmed') {
            return channels.map(values => {
                const sorted = [...values].sort((a, b) => a - b);
                const trim = Math.floor(sorted.length * 0.1);
                const retained = sorted.slice(trim, Math.max(trim + 1, sorted.length - trim));
                return Math.round(retained.reduce((sum, value) => sum + value, 0) / retained.length);
            });
        }

        const center = channels.map(values => median(values));
        const retainedCount = Math.max(1, Math.ceil(pixels.length * 0.7));
        const retained = [...pixels]
            .sort((first, second) => {
                const firstDistance = first.reduce((sum, value, channel) => {
                    const delta = value - center[channel];
                    return sum + delta * delta;
                }, 0);
                const secondDistance = second.reduce((sum, value, channel) => {
                    const delta = value - center[channel];
                    return sum + delta * delta;
                }, 0);
                return firstDistance - secondDistance;
            })
            .slice(0, retainedCount);
        return [0, 1, 2].map(channel => Math.round(
            retained.reduce((sum, pixel) => sum + pixel[channel], 0) / retained.length
        ));
    }

    function readPixel(data, width, height, x, y) {
        const boundedX = Math.max(0, Math.min(width - 1, Math.round(x)));
        const boundedY = Math.max(0, Math.min(height - 1, Math.round(y)));
        const index = (boundedY * width + boundedX) * 4;
        return [data[index], data[index + 1], data[index + 2]];
    }

    function extractGridColors(imageData, options) {
        if (!imageData || !imageData.data || !Number.isInteger(imageData.width) || imageData.width < 1
                || !Number.isInteger(imageData.height) || imageData.height < 1
                || imageData.data.length !== imageData.width * imageData.height * 4) {
            throw new Error('Grid extraction requires valid image data');
        }
        if (!options || typeof options !== 'object') {
            throw new Error('Grid extraction options are required');
        }
        const rows = options.rows;
        const columns = options.columns;
        const borderPercentage = options.borderPercentage;
        const method = options.method || 'histogram';
        if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(columns) || columns < 1) {
            throw new Error('Grid rows and columns must be positive integers');
        }
        if (!Number.isFinite(borderPercentage) || borderPercentage < 0 || borderPercentage >= 100) {
            throw new Error('Grid border percentage must be from 0 up to (but not including) 100');
        }

        const colors = [];
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;
        const useAlignment = Boolean(options.useAlignment);
        const homography = useAlignment
            ? calculateUnitSquareHomography(options.corners)
            : null;

        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                const pixels = [];
                if (!useAlignment) {
                    const bounds = calculateCellBounds(
                        width,
                        height,
                        rows,
                        columns,
                        borderPercentage,
                        row,
                        column
                    );
                    if (bounds.width <= 0 || bounds.height <= 0) {
                        throw new Error('Color grid cells are too small for the selected border percentage');
                    }
                    for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
                        for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
                            pixels.push(readPixel(data, width, height, x, y));
                        }
                    }
                } else {
                    const inset = borderPercentage / 200;
                    const startU = (column + inset) / columns;
                    const endU = (column + 1 - inset) / columns;
                    const startV = (row + inset) / rows;
                    const endV = (row + 1 - inset) / rows;
                    const sampleColumns = Math.max(12, Math.min(128, Math.round(width / columns)));
                    const sampleRows = Math.max(12, Math.min(128, Math.round(height / rows)));
                    for (let sampleY = 0; sampleY < sampleRows; sampleY++) {
                        const v = startV + (sampleY + 0.5) / sampleRows * (endV - startV);
                        for (let sampleX = 0; sampleX < sampleColumns; sampleX++) {
                            const u = startU + (sampleX + 0.5) / sampleColumns * (endU - startU);
                            const [mappedX, mappedY] = mapUnitSquarePoint(homography, u, v);
                            pixels.push(readPixel(data, width, height, mappedX * (width - 1), mappedY * (height - 1)));
                        }
                    }
                }
                colors.push(summarizePixels(pixels, method));
            }
        }

        return colors;
    }

    function generateCubeData(size, transformOptions, onProgress, metadata = {}) {
        if (!Number.isInteger(size) || size < 2) {
            throw new Error('CUBE size must be an integer of at least 2');
        }

        const rows = [];
        const total = size * size * size;
        let completed = 0;
        let nextProgress = 10;

        for (let blue = 0; blue < size; blue++) {
            for (let green = 0; green < size; green++) {
                for (let red = 0; red < size; red++) {
                    const input = [red, green, blue].map(value => value * 255 / (size - 1));
                    const output = transformRgb(input[0], input[1], input[2], {
                        ...transformOptions,
                        quantizeOutput: false
                    });
                    rows.push(output.map(value => (value / 255).toFixed(6)).join(' '));

                    completed++;
                    const progress = Math.floor(completed / total * 100);
                    if (onProgress && progress >= nextProgress) {
                        onProgress(progress);
                        nextProgress += 10;
                    }
                }
            }
        }

        const title = String(metadata.title || 'Custom LUT')
            .replace(/[\r\n]+/g, ' ')
            .replace(/"/g, "'")
            .trim()
            .slice(0, 80) || 'Custom LUT';
        return `# CUBE LUT generated by LUT Maker\nTITLE "${title}"\nLUT_3D_SIZE ${size}\nDOMAIN_MIN 0.000000 0.000000 0.000000\nDOMAIN_MAX 1.000000 1.000000 1.000000\n\n${rows.join('\n')}`;
    }

    return Object.freeze({
        applyGamma,
        applyMultivariate,
        applyPolynomial,
        applyRolloff,
        buildTransformationModels,
        calculateCellBounds,
        calculateRobustWeights,
        calculateUnitSquareHomography,
        deltaE76,
        evaluateTransformationModels,
        extractGridColors,
        generateCubeData,
        generateRolloffCurves,
        hasCompleteMultivariateModel,
        mapUnitSquarePoint,
        neutralLutRgbAt,
        neutralLutValue,
        predictRgb,
        rgbToLab,
        roundHalfToEven,
        solveLeastSquaresQr,
        standardDeviation,
        summarizePixels,
        toUint8,
        transformRgb
    });
}));
