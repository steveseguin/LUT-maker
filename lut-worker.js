'use strict';

importScripts('lut-core.js');

function postProgress(taskId, value) {
    self.postMessage({ type: 'progress', taskId, value });
}

function transformBuffer(buffer, options, taskId, progressStart = 0, progressEnd = 100) {
    const data = new Uint8ClampedArray(buffer);
    const pixelCount = data.length / 4;
    const progressRange = progressEnd - progressStart;
    let nextProgress = 10;

    for (let index = 0; index < data.length; index += 4) {
        const [red, green, blue] = LUTCore.transformRgb(
            data[index],
            data[index + 1],
            data[index + 2],
            options
        );
        data[index] = red;
        data[index + 1] = green;
        data[index + 2] = blue;

        const completed = index / 4 + 1;
        const progress = Math.floor(completed / pixelCount * 100);
        if (progress >= nextProgress) {
            postProgress(taskId, progressStart + progressRange * progress / 100);
            nextProgress += 10;
        }
    }
    return data;
}

function generateObsLutBuffer(options, taskId) {
    const width = 512;
    const height = 512;
    const data = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [red, green, blue] = LUTCore.neutralLutRgbAt(x, y);
            const index = (y * width + x) * 4;
            data[index] = red;
            data[index + 1] = green;
            data[index + 2] = blue;
            data[index + 3] = 255;
        }
        if ((y + 1) % 64 === 0) {
            postProgress(taskId, (y + 1) / height * 30);
        }
    }

    transformBuffer(data.buffer, options, taskId, 30, 100);
    return data;
}

self.addEventListener('message', event => {
    const message = event.data || {};
    const taskId = message.taskId;

    try {
        if (message.type === 'transformImage') {
            const data = transformBuffer(message.buffer, message.options, taskId);
            self.postMessage({
                type: 'complete',
                taskId,
                buffer: data.buffer,
                width: message.width,
                height: message.height
            }, [data.buffer]);
            return;
        }

        if (message.type === 'generateObsLut') {
            const data = generateObsLutBuffer(message.options, taskId);
            self.postMessage({
                type: 'complete',
                taskId,
                buffer: data.buffer,
                width: 512,
                height: 512
            }, [data.buffer]);
            return;
        }

        if (message.type === 'generateCube') {
            const data = LUTCore.generateCubeData(
                message.size,
                message.options,
                progress => postProgress(taskId, progress),
                message.metadata
            );
            self.postMessage({ type: 'complete', taskId, data });
            return;
        }

        throw new Error(`Unknown worker task: ${message.type || '(missing type)'}`);
    } catch (error) {
        self.postMessage({
            type: 'error',
            taskId,
            message: error instanceof Error ? error.message : String(error)
        });
    }
});
