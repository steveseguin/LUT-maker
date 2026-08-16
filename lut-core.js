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

    function solveLeastSquares(designMatrix, targetValues, equationWeights) {
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

    function fitPolynomial(values, targets, degree, equationWeights) {
        return solveLeastSquares(buildPolynomialMatrix(values, degree), targets, equationWeights);
    }

    function fitBasicChannel(capturedColors, values, targets, degree, useWeightedRegression) {
        const initialCoefficients = fitPolynomial(values, targets, degree);

        if (!useWeightedRegression) {
            return initialCoefficients;
        }

        const residuals = values.map((value, index) => targets[index] - applyPolynomial(value, initialCoefficients));
        const robustWeights = calculateRobustWeights(capturedColors, residuals);

        // numpy.polyfit applies its `w` argument to the unsquared residual.
        // Squaring here reproduces the notebook's final normal equations.
        const equationWeights = robustWeights.map(weight => weight * weight);
        return fitPolynomial(values, targets, degree, equationWeights);
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

    function fitMultivariateChannel(colors, targets, degree, useWeightedRegression) {
        const degrees = buildMultivariateDegrees(degree);
        const designMatrix = buildMultivariateMatrix(colors, degrees);
        const initialCoefficients = solveLeastSquares(designMatrix, targets);

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
            coefficients: solveLeastSquares(designMatrix, targets, equationWeights),
            degrees
        };
    }

    function buildTransformationModels(capturedColors, referenceColors, options = {}) {
        if (!Array.isArray(capturedColors) || !Array.isArray(referenceColors)
                || capturedColors.length !== referenceColors.length || capturedColors.length === 0) {
            throw new Error('Captured and reference color arrays must be non-empty and the same length');
        }

        const polynomialDegree = options.polynomialDegree || 1;
        const multivariateDegree = options.multivariateDegree || 2;
        const useWeightedRegression = Boolean(options.useWeightedRegression);
        const channelNames = ['red', 'green', 'blue'];
        const basic = {};

        for (let channel = 0; channel < 3; channel++) {
            basic[channelNames[channel]] = fitBasicChannel(
                capturedColors,
                capturedColors.map(color => color[channel]),
                referenceColors.map(color => color[channel]),
                polynomialDegree,
                useWeightedRegression
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
                useWeightedRegression
            );
        }

        return { basic, multivariate };
    }

    function hasCompleteMultivariateModel(models) {
        return Boolean(models && models.multivariate
            && models.multivariate.red && models.multivariate.green && models.multivariate.blue);
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
        const useAdvanced = Boolean(options.useAdvancedProcessing) && hasCompleteMultivariateModel(models);
        let transformed;

        if (useAdvanced) {
            const inputColor = [r, g, b];
            transformed = [
                applyMultivariate(inputColor, models.multivariate.red),
                applyMultivariate(inputColor, models.multivariate.green),
                applyMultivariate(inputColor, models.multivariate.blue)
            ];
        } else {
            transformed = [
                applyPolynomial(r, models.basic.red),
                applyPolynomial(g, models.basic.green),
                applyPolynomial(b, models.basic.blue)
            ];
        }

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

    function generateCubeData(size, transformOptions, onProgress) {
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

        return `# CUBE LUT generated by LUT Maker\nLUT_3D_SIZE ${size}\n\n${rows.join('\n')}`;
    }

    return Object.freeze({
        applyGamma,
        applyMultivariate,
        applyPolynomial,
        applyRolloff,
        buildTransformationModels,
        calculateCellBounds,
        calculateRobustWeights,
        generateCubeData,
        generateRolloffCurves,
        hasCompleteMultivariateModel,
        neutralLutRgbAt,
        neutralLutValue,
        roundHalfToEven,
        standardDeviation,
        toUint8,
        transformRgb
    });
}));
