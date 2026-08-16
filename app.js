        // Main app state
        const state = {
            rows: 3,
            columns: 3,
            cellBorderPercentage: 25,
            referenceColors: [],
            capturedColors: [],
            selectedCellIndex: null,
            colorCardImage: null,
            testImage: null,
            processedTestImage: null,
            polynomialDegree: 1,
            regressionSolver: 'notebook',
            samplingMethod: 'histogram',
            useChartAlignment: false,
            chartCorners: [[0.03, 0.03], [0.97, 0.03], [0.97, 0.97], [0.03, 0.97]],
            activeAlignmentHandle: null,
            isDraggingAlignment: false,
            brightnessAdjustment: 0,
            gammaValue: 1.0,
            lutSize: 32,
            lutFormat: 'png',
            cubeTitle: 'Custom LUT',
            lutImage: null,
            cubeData: null,
			useAdvancedProcessing: true,
			applyRolloffCurves: true,
			useWeightedRegression: false,
			useBackgroundProcessing: true,
			qualityMetrics: null,
			previewWorker: null,
			exportWorker: null,
			previewJobId: 0,
			workerTaskCounter: 0,
			generationRevision: 0,
			transformationModels: {
				basic: {
					red: null,
					green: null,
					blue: null
				},
				multivariate: {
					red: null,
					green: null,
					blue: null
				}
			},
			rolloffCurves: null,
			isGeneratingLUT: false
        };

		document.addEventListener('DOMContentLoaded', function() {
		  // Call the original initialization
		  initializeSliders();
		  initializeTabs();
		  initializeReferenceGrid();
		  initializeColorCardUpload();
		  initializeTestImageUpload();
		  initializeProcessing();
		  initializeExport();
		  initializeEventListeners();
		  initializeTemplateControls();
		  initializeAlignmentControls();

		  // Restore the saved chart configuration before the user starts editing.
		  try {
			if (localStorage.getItem('lutMakerTemplate')) {
			  loadTemplate();
			}
		  } catch (error) {
			// Browser storage is optional and can be disabled by privacy settings.
		  }

		  // Log welcome message
		  logMessage('Welcome to the Browser-based LUT Maker!', 'info');
		});

        // Debounce function to delay execution
        function debounce(func, wait) {
            let timeout;
            let lastArgs;
            let lastContext;
            function executedFunction(...args) {
                lastArgs = args;
                lastContext = this;
                const later = () => {
                    clearTimeout(timeout);
                    timeout = null;
                    func.apply(lastContext, lastArgs);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            }
            executedFunction.cancel = () => {
                clearTimeout(timeout);
                timeout = null;
            };
            executedFunction.flush = () => {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                    func.apply(lastContext, lastArgs);
                }
            };
            return executedFunction;
        }

        // Auto-apply adjustments when sliders stop moving
        const autoApplyAdjustments = debounce(function() {
            if (state.testImage) {
                processTestImage();
            }
        }, 500); // Wait 500ms after user stops adjusting

        const refreshColorExtraction = debounce(function() {
            if (state.colorCardImage) {
                extractColorsFromImage(state.colorCardImage);
            }
        }, 250);

        function terminateWorker(slot, reason) {
            const worker = state[slot];
            if (!worker) {
                return;
            }
            state[slot] = null;
            worker.terminate();
            if (reason && worker.taskReject) {
                const error = new Error(reason);
                error.name = 'AbortError';
                worker.taskReject(error);
            }
            worker.taskReject = null;
        }

        function runWorkerTask(slot, payload, transferables = [], onProgress) {
            return new Promise((resolve, reject) => {
                terminateWorker(slot, 'Superseded by a newer processing request');
                const worker = new Worker('lut-worker.js');
                const taskId = ++state.workerTaskCounter;
                state[slot] = worker;
                worker.taskReject = reject;

                const finish = () => {
                    if (state[slot] === worker) {
                        state[slot] = null;
                    }
                    worker.taskReject = null;
                    worker.terminate();
                };

                worker.addEventListener('message', event => {
                    const message = event.data;
                    if (!message || message.taskId !== taskId) {
                        return;
                    }
                    if (message.type === 'progress') {
                        if (onProgress) {
                            onProgress(message.value);
                        }
                        return;
                    }
                    finish();
                    if (message.type === 'error') {
                        reject(new Error(message.message));
                    } else {
                        resolve(message);
                    }
                });
                worker.addEventListener('error', event => {
                    finish();
                    reject(new Error(event.message || 'Background processing failed'));
                });
                worker.postMessage({ ...payload, taskId }, transferables);
            });
        }

        async function transformImageData(imageData, slot = 'previewWorker') {
            if (!state.useBackgroundProcessing || typeof Worker === 'undefined') {
                return transformLutImageData(imageData);
            }
            const response = await runWorkerTask(
                slot,
                {
                    type: 'transformImage',
                    width: imageData.width,
                    height: imageData.height,
                    buffer: imageData.data.buffer,
                    options: getTransformOptions(true)
                },
                [imageData.data.buffer]
            );
            return new ImageData(new Uint8ClampedArray(response.buffer), response.width, response.height);
        }

        // Initialize sliders and inputs
        function initializeSliders() {
            // Rows slider
            const rowsSlider = document.getElementById('rows-slider');
            const rowsValue = document.getElementById('rows-value');
            rowsSlider.addEventListener('input', function() {
                state.rows = parseInt(this.value);
                rowsValue.textContent = state.rows;
                initializeReferenceGrid();
                state.capturedColors = [];
                updateCapturedColorsGrid();
                invalidateTransformation();
                refreshColorExtraction();
            });

            // Columns slider
            const columnsSlider = document.getElementById('columns-slider');
            const columnsValue = document.getElementById('columns-value');
            columnsSlider.addEventListener('input', function() {
                state.columns = parseInt(this.value);
                columnsValue.textContent = state.columns;
                initializeReferenceGrid();
                state.capturedColors = [];
                updateCapturedColorsGrid();
                invalidateTransformation();
                refreshColorExtraction();
            });

            // Cell border slider
            const borderSlider = document.getElementById('border-slider');
            const borderValue = document.getElementById('border-value');
            borderSlider.addEventListener('input', function() {
                state.cellBorderPercentage = parseInt(this.value);
                borderValue.textContent = state.cellBorderPercentage + '%';
                state.capturedColors = [];
                updateCapturedColorsGrid();
                invalidateTransformation();
                refreshColorExtraction();
            });

            // Polynomial degree slider
            const polySlider = document.getElementById('polynomial-slider');
            const polyValue = document.getElementById('polynomial-value');
            polySlider.addEventListener('input', function() {
                state.polynomialDegree = parseInt(this.value);
                polyValue.textContent = state.polynomialDegree;
                invalidateTransformation();
            });

            // Brightness slider with auto-apply
            const brightnessSlider = document.getElementById('brightness-slider');
            const brightnessValue = document.getElementById('brightness-value');
            brightnessSlider.addEventListener('input', function() {
                state.brightnessAdjustment = parseInt(this.value);
                brightnessValue.textContent = state.brightnessAdjustment;
                invalidateGeneratedLUT();
                autoApplyAdjustments(); // Debounced update while dragging
            });
            brightnessSlider.addEventListener('change', function() {
                // Apply immediately when user releases the slider
                autoApplyAdjustments.cancel();
                if (state.testImage) {
                    processTestImage();
                }
            });

            // Gamma slider with auto-apply
            const gammaSlider = document.getElementById('gamma-slider');
            const gammaValue = document.getElementById('gamma-value');
            gammaSlider.addEventListener('input', function() {
                state.gammaValue = parseFloat(this.value);
                gammaValue.textContent = state.gammaValue.toFixed(1);
                invalidateGeneratedLUT();
                autoApplyAdjustments(); // Debounced update while dragging
            });
            gammaSlider.addEventListener('change', function() {
                // Apply immediately when user releases the slider
                autoApplyAdjustments.cancel();
                if (state.testImage) {
                    processTestImage();
                }
            });

            // CUBE size preset
            const lutSizeSelect = document.getElementById('lut-size-select');
            lutSizeSelect.addEventListener('change', function() {
                state.lutSize = parseInt(this.value);
                invalidateGeneratedLUT();
            });

            // LUT format select
            const lutFormat = document.getElementById('lut-format');
            lutFormat.addEventListener('change', function() {
                state.lutFormat = this.value;
                const isCube = this.value === 'cube';
                document.getElementById('cube-size-control').hidden = !isCube;
                document.getElementById('cube-title-control').hidden = !isCube;
                invalidateGeneratedLUT();
            });

            document.getElementById('cube-title').addEventListener('input', function() {
                state.cubeTitle = this.value;
                invalidateGeneratedLUT();
            });
        }

        // Helper function to log messages
        function logMessage(message, type = 'info') {
            const logContainer = document.getElementById('process-log');
            const logEntry = document.createElement('div');
            logEntry.className = `log-entry ${type}`;
            logEntry.textContent = message;
            logContainer.appendChild(logEntry);
            while (logContainer.childElementCount > 200) {
                logContainer.firstElementChild.remove();
            }
            logContainer.scrollTop = logContainer.scrollHeight;
        }

        // Update progress bar
        function updateProgress(containerId, value) {
            const progressBar = document.getElementById(`${containerId}-progress-bar`);
            const boundedValue = Math.max(0, Math.min(100, value));
            progressBar.style.width = `${boundedValue}%`;
            const progressContainer = document.getElementById(`${containerId}-progress-container`);
            progressContainer.setAttribute('aria-valuenow', String(boundedValue));
        }

        function invalidateGeneratedLUT(cancelActive = true) {
            if (cancelActive && state.isGeneratingLUT) {
                terminateWorker('exportWorker', 'LUT generation was cancelled because its settings changed');
                setExportBusy(false);
            }
            state.generationRevision++;
            state.cubeData = null;
            state.lutImage = null;
            document.getElementById('lut-download-container').hidden = true;
            updateProgress('export', 0);
        }

        function invalidateTransformation() {
            state.previewJobId++;
            terminateWorker('previewWorker', 'Preview processing was cancelled because its settings changed');
            state.transformationModels = {
                basic: { red: null, green: null, blue: null },
                multivariate: { red: null, green: null, blue: null }
            };
            state.rolloffCurves = null;
            state.qualityMetrics = null;
            document.getElementById('quality-report').hidden = true;
            document.getElementById('process-next').disabled = true;
            document.getElementById('test-next').disabled = true;
            updateProgress('process', 0);
            invalidateGeneratedLUT();
            if (state.testImage) {
                displayTestImage(state.testImage);
            }
        }

        function getTransformOptions(quantizeOutput = false) {
            return {
                models: state.transformationModels,
                useAdvancedProcessing: state.useAdvancedProcessing,
                applyRolloffCurves: state.applyRolloffCurves,
                rolloffCurves: state.rolloffCurves,
                brightnessAdjustment: state.brightnessAdjustment,
                gammaValue: state.gammaValue,
                quantizeOutput
            };
        }

        function setExportBusy(isBusy) {
            state.isGeneratingLUT = isBusy;
            const generateButton = document.getElementById('generate-lut');
            const downloadButton = document.getElementById('download-lut');
            generateButton.disabled = isBusy;
            generateButton.textContent = isBusy ? 'Generating…' : 'Generate LUT';
            downloadButton.disabled = isBusy;
        }

        // RGB to Hex conversion
        function rgbToHex(rgb) {
            return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
        }

        // Update the captured colors grid
        function updateCapturedColorsGrid() {
            const gridContainer = document.getElementById('captured-grid');
            gridContainer.replaceChildren();
            gridContainer.style.gridTemplateColumns = `repeat(${state.columns}, 1fr)`;

            for (let i = 0; i < state.capturedColors.length; i++) {
                const cell = document.createElement('div');
                cell.className = 'color-cell';
                cell.style.backgroundColor = rgbToHex(state.capturedColors[i]);
                cell.title = `Captured ${i + 1}: ${state.capturedColors[i].join(', ')}`;
                cell.setAttribute('aria-label', cell.title);
                gridContainer.appendChild(cell);
            }

            // Also update target grid
            const targetGrid = document.getElementById('target-grid');
            targetGrid.replaceChildren();
            targetGrid.style.gridTemplateColumns = `repeat(${state.columns}, 1fr)`;

            for (let i = 0; i < state.referenceColors.length; i++) {
                const cell = document.createElement('div');
                cell.className = 'color-cell';
                cell.style.backgroundColor = rgbToHex(state.referenceColors[i]);
                cell.title = `Target ${i + 1}: ${state.referenceColors[i].join(', ')}`;
                cell.setAttribute('aria-label', cell.title);
                targetGrid.appendChild(cell);
            }
        }

        // Initialize tabs
        function initializeTabs() {
            const tabButtons = document.querySelectorAll('.tab-btn');
            const tabPanels = document.querySelectorAll('.tab-panel');

            tabButtons.forEach(button => {
                button.addEventListener('click', function() {
                    const tabId = this.getAttribute('data-tab');

                    // Only allow clicking on enabled tabs
                    if (this.disabled) return;

                    // Deactivate all tabs
                    tabButtons.forEach(btn => {
                        btn.classList.remove('active');
                        btn.setAttribute('aria-selected', 'false');
                        btn.tabIndex = -1;
                    });
                    tabPanels.forEach(panel => {
                        panel.classList.remove('active');
                        panel.hidden = true;
                    });

                    // Activate the clicked tab
                    this.classList.add('active');
                    this.setAttribute('aria-selected', 'true');
                    this.tabIndex = 0;
                    const activePanel = document.getElementById(`${tabId}-tab`);
                    activePanel.classList.add('active');
                    activePanel.hidden = false;
                });

                button.addEventListener('keydown', event => {
                    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
                        return;
                    }
                    const enabledTabs = [...tabButtons].filter(tab => !tab.disabled);
                    const currentIndex = enabledTabs.indexOf(button);
                    let nextIndex;
                    if (event.key === 'Home') {
                        nextIndex = 0;
                    } else if (event.key === 'End') {
                        nextIndex = enabledTabs.length - 1;
                    } else {
                        const offset = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
                        nextIndex = (currentIndex + offset + enabledTabs.length) % enabledTabs.length;
                    }
                    enabledTabs[nextIndex].focus();
                    enabledTabs[nextIndex].click();
                    event.preventDefault();
                });
            });

            // Next button handlers
            document.getElementById('setup-next').addEventListener('click', function() {
                enableTab('reference');
                activateTab('reference');
            });

            document.getElementById('reference-next').addEventListener('click', function() {
                enableTab('colorcard');
                activateTab('colorcard');
            });

            document.getElementById('colorcard-next').addEventListener('click', function() {
                refreshColorExtraction.flush();
                enableTab('process');
                activateTab('process');
            });

            document.getElementById('process-next').addEventListener('click', function() {
                enableTab('test');
                activateTab('test');
            });

            document.getElementById('test-next').addEventListener('click', function() {
                enableTab('export');
                activateTab('export');
            });

            // Previous button handlers
            document.getElementById('reference-prev').addEventListener('click', function() {
                activateTab('setup');
            });

            document.getElementById('colorcard-prev').addEventListener('click', function() {
                activateTab('reference');
            });

            document.getElementById('process-prev').addEventListener('click', function() {
                activateTab('colorcard');
            });

            document.getElementById('test-prev').addEventListener('click', function() {
                activateTab('process');
            });

            document.getElementById('export-prev').addEventListener('click', function() {
                activateTab('test');
            });
        }

        // Enable a tab
        function enableTab(tabId) {
            const tabButton = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
            if (tabButton) {
                tabButton.disabled = false;
            }
        }

        // Activate a tab
        function activateTab(tabId) {
            const tabButton = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
            if (tabButton && !tabButton.disabled) {
                tabButton.focus();
                tabButton.click();
            }
        }

        // Initialize reference color grid
        function initializeReferenceGrid() {
            const gridContainer = document.getElementById('reference-grid');
            gridContainer.replaceChildren();
            gridContainer.style.gridTemplateColumns = `repeat(${state.columns}, 1fr)`;

            // Initialize with default colors if not already set
            if (state.referenceColors.length !== state.rows * state.columns) {
                state.referenceColors = Array(state.rows * state.columns).fill().map(() => [128, 128, 128]);
            }

            // Create color cells
            for (let i = 0; i < state.rows * state.columns; i++) {
                const cell = document.createElement('button');
                cell.type = 'button';
                cell.className = 'color-cell';
                cell.dataset.index = i;
                cell.style.backgroundColor = rgbToHex(state.referenceColors[i]);
                cell.setAttribute('aria-label', `Edit reference color ${i + 1}: ${state.referenceColors[i].join(', ')}`);
                cell.setAttribute('aria-pressed', state.selectedCellIndex === i ? 'true' : 'false');

                cell.addEventListener('click', function() {
                    selectCell(parseInt(this.dataset.index));
                });

                gridContainer.appendChild(cell);
            }

            const preferredIndex = Number.isInteger(state.selectedCellIndex)
                ? Math.min(state.selectedCellIndex, state.referenceColors.length - 1)
                : 0;
            selectCell(preferredIndex);
        }

        // Select a color cell
        function selectCell(index) {
            state.selectedCellIndex = index;

            // Update all cell borders
            const cells = document.querySelectorAll('#reference-grid .color-cell');
            cells.forEach(cell => {
                cell.style.border = '1px solid #ddd';
                cell.setAttribute('aria-pressed', 'false');
            });

            // Highlight selected cell
            const selectedCell = document.querySelector(`#reference-grid .color-cell[data-index="${index}"]`);
            if (selectedCell) {
                selectedCell.style.border = '3px solid #000';
                selectedCell.setAttribute('aria-pressed', 'true');
            }

            // Update color inputs
            const [r, g, b] = state.referenceColors[index];
            document.getElementById('red-input').value = r;
            document.getElementById('green-input').value = g;
            document.getElementById('blue-input').value = b;

            // Update color preview
            const colorPreview = document.getElementById('selected-color-preview');
            colorPreview.style.backgroundColor = rgbToHex(state.referenceColors[index]);
        }

       function initializeColorCardUpload() {
			const fileInput = document.getElementById('colorcard-upload');
			fileInput.addEventListener('change', function(event) {
			  const file = event.target.files[0];
			  if (file) {
				loadImage(file, 'colorcard');
			  }
			});

			// Add demo image functionality properly
			const demoButton = document.getElementById('use-demo-image');
			if (demoButton) {
			  demoButton.addEventListener('click', function() {
				loadDemoImage('colorcard');
			  });
			}
		  };

        function resetChartCorners() {
            state.chartCorners = [[0.03, 0.03], [0.97, 0.03], [0.97, 0.97], [0.03, 0.97]];
        }

        function drawColorCardOverlay() {
            const canvas = document.getElementById('colorcard-preview');
            if (!state.colorCardImage || !canvas.width || !canvas.height) {
                return;
            }
            const context = canvas.getContext('2d');
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(state.colorCardImage, 0, 0, canvas.width, canvas.height);
            if (!state.useChartAlignment) {
                return;
            }

            const homography = LUTCore.calculateUnitSquareHomography(state.chartCorners);
            const drawMappedLine = (fixedValue, vertical) => {
                context.beginPath();
                for (let step = 0; step <= 40; step++) {
                    const varyingValue = step / 40;
                    const [x, y] = vertical
                        ? LUTCore.mapUnitSquarePoint(homography, fixedValue, varyingValue)
                        : LUTCore.mapUnitSquarePoint(homography, varyingValue, fixedValue);
                    const canvasX = x * canvas.width;
                    const canvasY = y * canvas.height;
                    if (step === 0) {
                        context.moveTo(canvasX, canvasY);
                    } else {
                        context.lineTo(canvasX, canvasY);
                    }
                }
                context.stroke();
            };

            context.save();
            context.strokeStyle = 'rgba(255, 255, 255, 0.95)';
            context.lineWidth = 3;
            for (let column = 0; column <= state.columns; column++) {
                drawMappedLine(column / state.columns, true);
            }
            for (let row = 0; row <= state.rows; row++) {
                drawMappedLine(row / state.rows, false);
            }
            context.strokeStyle = 'rgba(20, 95, 180, 0.95)';
            context.lineWidth = 1;
            for (let column = 0; column <= state.columns; column++) {
                drawMappedLine(column / state.columns, true);
            }
            for (let row = 0; row <= state.rows; row++) {
                drawMappedLine(row / state.rows, false);
            }

            const labels = ['TL', 'TR', 'BR', 'BL'];
            state.chartCorners.forEach(([x, y], index) => {
                const canvasX = x * canvas.width;
                const canvasY = y * canvas.height;
                context.beginPath();
                context.arc(canvasX, canvasY, 10, 0, Math.PI * 2);
                context.fillStyle = index === state.activeAlignmentHandle ? '#ffc107' : '#ffffff';
                context.fill();
                context.strokeStyle = '#164f91';
                context.lineWidth = 3;
                context.stroke();
                context.fillStyle = '#102a43';
                context.font = 'bold 12px sans-serif';
                context.fillText(`${index + 1} ${labels[index]}`, canvasX + 13, canvasY - 11);
            });
            context.restore();
        }

        function updateAlignmentPoint(event) {
            if (state.activeAlignmentHandle === null) {
                return;
            }
            const canvas = document.getElementById('colorcard-preview');
            const bounds = canvas.getBoundingClientRect();
            const x = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
            const y = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
            const nextCorners = state.chartCorners.map(point => [...point]);
            nextCorners[state.activeAlignmentHandle] = [x, y];
            try {
                LUTCore.calculateUnitSquareHomography(nextCorners);
            } catch (error) {
                return;
            }
            state.chartCorners = nextCorners;
            drawColorCardOverlay();
        }

        function initializeAlignmentControls() {
            const canvas = document.getElementById('colorcard-preview');
            const alignmentToggle = document.getElementById('alignment-toggle');
            const alignmentControls = document.getElementById('alignment-controls');

            document.getElementById('sampling-method').addEventListener('change', function() {
                state.samplingMethod = this.value;
                invalidateTransformation();
                refreshColorExtraction();
            });

            alignmentToggle.addEventListener('change', function() {
                state.useChartAlignment = this.checked;
                alignmentControls.hidden = !this.checked;
                canvas.classList.toggle('alignment-enabled', this.checked);
                state.activeAlignmentHandle = null;
                state.isDraggingAlignment = false;
                drawColorCardOverlay();
                invalidateTransformation();
                refreshColorExtraction();
            });

            document.getElementById('reset-alignment').addEventListener('click', () => {
                resetChartCorners();
                drawColorCardOverlay();
                invalidateTransformation();
                refreshColorExtraction();
            });
            document.getElementById('rotate-alignment-left').addEventListener('click', () => {
                state.chartCorners = [
                    state.chartCorners[1],
                    state.chartCorners[2],
                    state.chartCorners[3],
                    state.chartCorners[0]
                ];
                drawColorCardOverlay();
                invalidateTransformation();
                refreshColorExtraction();
            });
            document.getElementById('rotate-alignment-right').addEventListener('click', () => {
                state.chartCorners = [
                    state.chartCorners[3],
                    state.chartCorners[0],
                    state.chartCorners[1],
                    state.chartCorners[2]
                ];
                drawColorCardOverlay();
                invalidateTransformation();
                refreshColorExtraction();
            });

            canvas.addEventListener('pointerdown', event => {
                if (!state.useChartAlignment) {
                    return;
                }
                const bounds = canvas.getBoundingClientRect();
                const point = [
                    (event.clientX - bounds.left) / bounds.width,
                    (event.clientY - bounds.top) / bounds.height
                ];
                const distances = state.chartCorners.map(([x, y]) => Math.hypot(x - point[0], y - point[1]));
                const closest = distances.indexOf(Math.min(...distances));
                if (distances[closest] <= 0.08) {
                    state.activeAlignmentHandle = closest;
                    state.isDraggingAlignment = true;
                    invalidateTransformation();
                    canvas.setPointerCapture(event.pointerId);
                    updateAlignmentPoint(event);
                    event.preventDefault();
                }
            });
            canvas.addEventListener('pointermove', event => {
                if (state.isDraggingAlignment) {
                    updateAlignmentPoint(event);
                }
            });
            const finishPointerMove = event => {
                if (!state.isDraggingAlignment || state.activeAlignmentHandle === null) {
                    return;
                }
                updateAlignmentPoint(event);
                state.isDraggingAlignment = false;
                state.activeAlignmentHandle = null;
                drawColorCardOverlay();
                refreshColorExtraction();
            };
            canvas.addEventListener('pointerup', finishPointerMove);
            canvas.addEventListener('pointercancel', finishPointerMove);

            canvas.addEventListener('keydown', event => {
                if (!state.useChartAlignment) {
                    return;
                }
                if (/^[1-4]$/.test(event.key)) {
                    state.activeAlignmentHandle = Number(event.key) - 1;
                    drawColorCardOverlay();
                    event.preventDefault();
                    return;
                }
                if (state.activeAlignmentHandle === null || !event.key.startsWith('Arrow')) {
                    return;
                }
                const step = event.shiftKey ? 0.01 : 0.002;
                const point = [...state.chartCorners[state.activeAlignmentHandle]];
                if (event.key === 'ArrowLeft') point[0] -= step;
                if (event.key === 'ArrowRight') point[0] += step;
                if (event.key === 'ArrowUp') point[1] -= step;
                if (event.key === 'ArrowDown') point[1] += step;
                const nextCorners = state.chartCorners.map(corner => [...corner]);
                nextCorners[state.activeAlignmentHandle] = point.map(value => Math.max(0, Math.min(1, value)));
                try {
                    LUTCore.calculateUnitSquareHomography(nextCorners);
                } catch (error) {
                    return;
                }
                state.chartCorners = nextCorners;
                drawColorCardOverlay();
                invalidateTransformation();
                refreshColorExtraction();
                event.preventDefault();
            });
        }

        // Extract colors from the color card image
        function extractColorsFromImage(img) {
            logMessage('Extracting colors from image...', 'info');
            document.getElementById('colorcard-next').disabled = true;
            invalidateTransformation();

            try {
                const tempCanvas = document.createElement('canvas');
                const tempContext = tempCanvas.getContext('2d', { willReadFrequently: true });
                tempCanvas.width = img.width;
                tempCanvas.height = img.height;
                tempContext.drawImage(img, 0, 0);
                const imageData = tempContext.getImageData(0, 0, img.width, img.height);
                state.capturedColors = LUTCore.extractGridColors(imageData, {
                    rows: state.rows,
                    columns: state.columns,
                    borderPercentage: state.cellBorderPercentage,
                    method: state.samplingMethod,
                    useAlignment: state.useChartAlignment,
                    corners: state.chartCorners
                });
                updateCapturedColorsGrid();
                logMessage(
                    `Color extraction complete (${state.samplingMethod}${state.useChartAlignment ? ', aligned' : ''})`,
                    'success'
                );
                document.getElementById('colorcard-next').disabled = false;
            } catch (error) {
                state.capturedColors = [];
                updateCapturedColorsGrid();
                logMessage(`Color extraction failed: ${error.message}`, 'error');
            }
        }

        // Load an image file
		function loadImage(file, type) {
			if (!file || !file.type.startsWith('image/')) {
				logMessage('Please choose a supported image file', 'error');
				return;
			}
			if (file.size > 50 * 1024 * 1024) {
				logMessage('The selected image is larger than the 50 MB limit', 'error');
				return;
			}

			const imageUrl = URL.createObjectURL(file);
			const img = new Image();
			img.onload = function() {
				URL.revokeObjectURL(imageUrl);
				if (!img.width || !img.height || img.width * img.height > 50_000_000) {
					logMessage('The selected image dimensions are invalid or exceed the 50-megapixel limit', 'error');
					return;
				}
				if (type === 'colorcard') {
					state.colorCardImage = img;
					displayColorCardImage(img);
				} else if (type === 'test') {
					state.testImage = img;
					displayTestImage(img);
				}
				logMessage(`${type === 'colorcard' ? 'Color card' : 'Test'} image loaded successfully`, 'success');
			};
			img.onerror = function() {
				URL.revokeObjectURL(imageUrl);
				logMessage('The selected image could not be decoded', 'error');
			};
			img.src = imageUrl;
		}

        // Initialize the processing functionality
        function initializeProcessing() {
            // Process button
            document.getElementById('process-button').addEventListener('click', function() {
                processColorTransformation();
            });

            // Update selected color
            document.getElementById('update-color').addEventListener('click', function() {
                if (state.selectedCellIndex !== null) {
                    const r = parseInt(document.getElementById('red-input').value);
                    const g = parseInt(document.getElementById('green-input').value);
                    const b = parseInt(document.getElementById('blue-input').value);

                    state.referenceColors[state.selectedCellIndex] = [
                        isNaN(r) ? 0 : Math.min(255, Math.max(0, r)),
                        isNaN(g) ? 0 : Math.min(255, Math.max(0, g)),
                        isNaN(b) ? 0 : Math.min(255, Math.max(0, b))
                    ];

                    // Update grid
                    const cell = document.querySelector(`.color-cell[data-index="${state.selectedCellIndex}"]`);
                    if (cell) {
                        cell.style.backgroundColor = rgbToHex(state.referenceColors[state.selectedCellIndex]);
                        cell.setAttribute(
                            'aria-label',
                            `Edit reference color ${state.selectedCellIndex + 1}: ${state.referenceColors[state.selectedCellIndex].join(', ')}`
                        );
                    }

                    // Update preview
                    const colorPreview = document.getElementById('selected-color-preview');
                    colorPreview.style.backgroundColor = rgbToHex(state.referenceColors[state.selectedCellIndex]);
                    updateCapturedColorsGrid();
                    invalidateTransformation();
                }
            });

            // Reset colors
            document.getElementById('reset-colors').addEventListener('click', function() {
                state.referenceColors = Array(state.rows * state.columns).fill().map(() => [128, 128, 128]);
                initializeReferenceGrid();
                updateCapturedColorsGrid();
                invalidateTransformation();
            });

            // Use example colors (color chart from the original code)
            document.getElementById('use-example').addEventListener('click', function() {
                const exampleColors = [
                    [147, 163, 96], [154, 64, 73], [0, 166, 153],
                    [61, 65, 93], [96, 102, 102], [247, 185, 48],
                    [62, 63, 64], [245, 243, 236], [138, 83, 129]
                ];

                // Only use as many colors as there are cells
                state.referenceColors = [];
                for (let i = 0; i < state.rows * state.columns; i++) {
                    if (i < exampleColors.length) {
                        state.referenceColors.push(exampleColors[i]);
                    } else {
                        state.referenceColors.push([128, 128, 128]);
                    }
                }

                initializeReferenceGrid();
                updateCapturedColorsGrid();
                invalidateTransformation();
                logMessage('Example colors loaded', 'success');
            });
        }

		const colorPresets = {
		  demo3x3: {
			name: "Demo 3×3",
			rows: 3,
			columns: 3,
			cellBorderPercentage: 25,
			colors: [
			  [147, 163, 96], [154, 64, 73], [0, 166, 153],
			  [61, 65, 93], [96, 102, 102], [247, 185, 48],
			  [62, 63, 64], [245, 243, 236], [138, 83, 129]
			]
		  },
		  datacolor24: {
			name: "Datacolor SpyderCHECKR 24",
			rows: 4,
			columns: 6,
			cellBorderPercentage: 25,
			colors: [
			  [ 98, 187, 166], [126, 125, 174], [ 82, 106,  60], [ 87, 120, 155], [197, 145, 125], [112,  76,  60],
			  [222, 118,  32], [ 58,  89, 160], [195 , 79,  95], [ 83,  58, 106], [157, 188,  54], [238, 158,  25],
			  [  0, 127, 159], [192,  75, 145], [245, 205,   0], [186,  26,  51], [ 57, 146,  64], [ 25,  55, 135],
			  [249, 242, 238], [202, 198, 195], [161, 157, 154], [122, 118, 116], [ 80,  80,  78], [ 43,  41,  43]
			]
		  },
		  datacolor48: {
			name: "Datacolor SpyderCHECKR 48",
			rows: 6,
			columns: 8,
			cellBorderPercentage: 25,
			colors: [
			  /* sRGB values source: https://www.datacolor.com/spyder/downloads/SpyderCheckr_Color_Data_V2.pdf                                               */
			  /*                                     LEFT                                                                  RIGHT                             */
			  /*             A                B                C                D                  E                F                G                H      */
			  /* 1 */ [210, 121, 117], [218, 203, 201], [237, 206, 186], [241, 233, 229],   [249, 242, 238], [  0, 127, 159], [222, 118,  32], [ 98, 187, 166],
			  /* 2 */ [216, 179,  90], [203, 205, 196], [211, 175, 133], [229, 222, 220],   [202, 198, 195], [192,  75, 145], [ 58,  88, 159], [126, 125, 174],
			  /* 3 */ [127, 175, 120], [206, 203, 208], [193, 149,  91], [182, 178, 176],   [161, 157, 154], [245, 205,   0], [195,  79,  95], [ 82, 106,  60],
			  /* 4 */ [ 66, 157, 179], [ 66,  57,  58], [139,  93,  61], [139, 136, 135],   [122, 118, 116], [186,  26,  51], [ 83,  58, 106], [ 87, 120, 155],
			  /* 5 */ [116, 147, 194], [ 54,  61,  56], [ 74,  55,  46], [100,  99,  97],   [ 80,  80,  78], [ 57, 146,  64], [157, 188,  54], [197, 145, 125],
			  /* 6 */ [190, 121, 154], [ 63,  60,  69], [ 57,  54,  56], [ 63,  61,  62],   [ 43,  41,  43], [ 25,  55, 135], [238, 158,  25], [112,  76,  60]
			]
		  },
		  // Can add other presets here
		};

		function createTemplate() {
		  return {
			version: 2,
			rows: state.rows,
			columns: state.columns,
			cellBorderPercentage: state.cellBorderPercentage,
			referenceColors: state.referenceColors.map(color => [...color]),
			samplingMethod: state.samplingMethod,
			useChartAlignment: state.useChartAlignment,
			chartCorners: state.chartCorners.map(point => [...point])
		  };
		}

		function validateTemplate(template) {
		  if (!template || !Number.isInteger(template.rows) || template.rows < 1 || template.rows > 8
			  || !Number.isInteger(template.columns) || template.columns < 1 || template.columns > 8) {
			throw new Error('Template rows and columns must be integers from 1 to 8');
		  }
		  if (!Number.isFinite(template.cellBorderPercentage)
			  || template.cellBorderPercentage < 0 || template.cellBorderPercentage > 50) {
			throw new Error('Template border percentage must be from 0 to 50');
		  }
		  if (!Array.isArray(template.referenceColors)
			  || template.referenceColors.length !== template.rows * template.columns
			  || template.referenceColors.some(color => !Array.isArray(color) || color.length < 3
				|| color.slice(0, 3).some(value => !Number.isFinite(value) || value < 0 || value > 255))) {
			throw new Error('Template reference colors are invalid or do not match the grid');
		  }
		  const samplingMethod = template.samplingMethod || 'histogram';
		  if (!['histogram', 'median', 'trimmed', 'cluster'].includes(samplingMethod)) {
			throw new Error('Template sampling method is not supported');
		  }
		  const chartCorners = template.chartCorners || [[0.03, 0.03], [0.97, 0.03], [0.97, 0.97], [0.03, 0.97]];
		  LUTCore.calculateUnitSquareHomography(chartCorners);
		  if (template.useChartAlignment !== undefined && typeof template.useChartAlignment !== 'boolean') {
			throw new Error('Template alignment setting must be true or false');
		  }

		  return {
			version: 2,
			rows: template.rows,
			columns: template.columns,
			cellBorderPercentage: template.cellBorderPercentage,
			referenceColors: template.referenceColors.map(color => color.slice(0, 3).map(value => Math.round(value))),
			samplingMethod,
			useChartAlignment: Boolean(template.useChartAlignment),
			chartCorners: chartCorners.map(point => point.slice(0, 2))
		  };
		}

		function applyTemplate(template, message) {
		  const validated = validateTemplate(template);
		  state.rows = validated.rows;
		  state.columns = validated.columns;
		  state.cellBorderPercentage = validated.cellBorderPercentage;
		  state.referenceColors = validated.referenceColors;
		  state.samplingMethod = validated.samplingMethod;
		  state.useChartAlignment = validated.useChartAlignment;
		  state.chartCorners = validated.chartCorners;

		  document.getElementById('rows-slider').value = state.rows;
		  document.getElementById('rows-value').textContent = state.rows;
		  document.getElementById('columns-slider').value = state.columns;
		  document.getElementById('columns-value').textContent = state.columns;
		  document.getElementById('border-slider').value = state.cellBorderPercentage;
		  document.getElementById('border-value').textContent = state.cellBorderPercentage + '%';
		  document.getElementById('sampling-method').value = state.samplingMethod;
		  document.getElementById('alignment-toggle').checked = state.useChartAlignment;
		  document.getElementById('alignment-controls').hidden = !state.useChartAlignment;
		  document.getElementById('colorcard-preview').classList.toggle('alignment-enabled', state.useChartAlignment);

		  initializeReferenceGrid();
		  state.capturedColors = [];
		  updateCapturedColorsGrid();
		  invalidateTransformation();
		  drawColorCardOverlay();
		  refreshColorExtraction();
		  logMessage(message, 'success');
		}

		function saveTemplate() {
		  const template = createTemplate();

		  try {
			localStorage.setItem('lutMakerTemplate', JSON.stringify(template));
			logMessage('Template saved to browser storage', 'success');
		  } catch (error) {
			logMessage('Failed to save template: ' + error.message, 'error');
		  }
		}

		function loadTemplate() {
		  try {
			const savedTemplate = localStorage.getItem('lutMakerTemplate');
			if (savedTemplate) {
			  applyTemplate(JSON.parse(savedTemplate), 'Template loaded from browser storage');
			} else {
			  logMessage('No saved template found', 'warning');
			}
		  } catch (error) {
			logMessage('Failed to load template: ' + error.message, 'error');
		  }
		}

		function exportTemplate() {
		  const blob = new Blob([JSON.stringify(createTemplate(), null, 2)], { type: 'application/json' });
		  const url = URL.createObjectURL(blob);
		  const link = document.createElement('a');
		  link.href = url;
		  link.download = 'lut-maker-template.json';
		  document.body.appendChild(link);
		  link.click();
		  link.remove();
		  URL.revokeObjectURL(url);
		  logMessage('Template exported as JSON', 'success');
		}

		function importTemplate(file) {
		  if (!file || file.size > 1024 * 1024) {
			logMessage('Template import failed: JSON templates must be no larger than 1 MB', 'error');
			return;
		  }
		  const reader = new FileReader();
		  reader.onload = () => {
			try {
			  applyTemplate(JSON.parse(reader.result), 'Template imported successfully');
			} catch (error) {
			  logMessage(`Template import failed: ${error.message}`, 'error');
			}
		  };
		  reader.onerror = () => logMessage('Template import failed: the file could not be read', 'error');
		  reader.readAsText(file);
		}

		// Apply preset colors
		function applyPreset(presetName) {
		  const preset = colorPresets[presetName];
		  if (!preset) {
			logMessage(`Preset "${presetName}" not found`, 'error');
			return;
		  }

		  // Update grid dimensions
		  state.rows = preset.rows;
		  state.columns = preset.columns;
		  state.cellBorderPercentage = preset.cellBorderPercentage ?? state.cellBorderPercentage;
		  document.getElementById('rows-slider').value = state.rows;
		  document.getElementById('rows-value').textContent = state.rows;
		  document.getElementById('columns-slider').value = state.columns;
		  document.getElementById('columns-value').textContent = state.columns;
		  document.getElementById('border-slider').value = state.cellBorderPercentage;
		  document.getElementById('border-value').textContent = state.cellBorderPercentage + '%';

		  // Update reference colors
		  state.referenceColors = preset.colors.map(color => [...color]);

		  // Refresh the grid
		  initializeReferenceGrid();
		  state.capturedColors = [];
		  updateCapturedColorsGrid();
		  invalidateTransformation();
		  refreshColorExtraction();

		  logMessage(`Applied "${preset.name}" color preset`, 'success');
		}

		// Initialize presets dropdown and template UI
		function initializeTemplateControls() {
		  // Add event listeners for template buttons
		  document.getElementById('apply-preset-button').addEventListener('click', function() {
			const select = document.getElementById('color-preset-select');
			const selectedPreset = select.value;
			if (selectedPreset) {
			  applyPreset(selectedPreset);
			} else {
			  logMessage('Please select a preset first', 'warning');
			}
		  });

		  document.getElementById('save-template-button').addEventListener('click', saveTemplate);
		  document.getElementById('load-template-button').addEventListener('click', loadTemplate);
		  document.getElementById('export-template-button').addEventListener('click', exportTemplate);
		  document.getElementById('import-template-input').addEventListener('change', function() {
			if (this.files[0]) {
			  importTemplate(this.files[0]);
			  this.value = '';
			}
		  });
		}


        // Color-model fitting is implemented in lut-core.js.
        // Process the test image with the current transformation
        async function processTestImage() {
            if (!state.testImage || !state.transformationModels.basic.red) {
                return;
            }

            const jobId = ++state.previewJobId;
            document.getElementById('test-next').disabled = true;
            logMessage('Processing test image...', 'info');

            try {
                const processedCanvas = document.getElementById('test-processed');
                const tempCanvas = document.createElement('canvas');
                const tempCtx = tempCanvas.getContext('2d');
                tempCanvas.width = processedCanvas.width;
                tempCanvas.height = processedCanvas.height;
                tempCtx.drawImage(state.testImage, 0, 0, tempCanvas.width, tempCanvas.height);

                const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
                const transformedImageData = await transformImageData(imageData, 'previewWorker');
                if (jobId !== state.previewJobId) {
                    return;
                }
                tempCtx.putImageData(transformedImageData, 0, 0);

                const processedCtx = processedCanvas.getContext('2d');
                processedCtx.clearRect(0, 0, processedCanvas.width, processedCanvas.height);
                processedCtx.drawImage(tempCanvas, 0, 0, processedCanvas.width, processedCanvas.height);

                document.getElementById('test-next').disabled = false;
                logMessage('Test image processing complete', 'success');
            } catch (error) {
                if (error.name === 'AbortError' || jobId !== state.previewJobId) {
                    return;
                }
                logMessage(`Test image processing failed: ${error.message}`, 'error');
            }
        }

        // Initialize export functionality
        function initializeExport() {
            document.getElementById('generate-lut').addEventListener('click', function() {
                generateLUT();
            });

            document.getElementById('download-lut').addEventListener('click', function() {
                downloadLUT();
            });
        }

		async function generateLUT() {
			if (!state.transformationModels.basic.red) {
				logMessage('No color transformation available. Please process colors first.', 'error');
				return;
			}
			if (state.isGeneratingLUT) {
				return;
			}

			setExportBusy(true);
			invalidateGeneratedLUT(false);
			const generationRevision = state.generationRevision;
			logMessage('Generating LUT...', 'info');

			try {
				// Let the busy state paint before a potentially large CUBE calculation.
				await new Promise(resolve => requestAnimationFrame(resolve));
				const lutCanvas = document.getElementById('lut-preview');
				const lutCtx = lutCanvas.getContext('2d');

				if (state.lutFormat === 'png') {
					await generate2dPngLUT(lutCanvas, lutCtx);
					if (generationRevision !== state.generationRevision) {
						throw new DOMException('LUT generation was superseded', 'AbortError');
					}
					state.lutImage = true;
				} else if (state.lutFormat === 'cube') {
					await generate3dCubeLUT(lutCanvas, lutCtx);
				}

				updateProgress('export', 100);
				logMessage('LUT generation complete!', 'success');
				document.getElementById('lut-download-container').hidden = false;
			} catch (error) {
				if (generationRevision === state.generationRevision) {
					setExportBusy(false);
					invalidateGeneratedLUT(false);
				}
				logMessage(
					error.name === 'AbortError' ? error.message : `LUT generation failed: ${error.message}`,
					error.name === 'AbortError' ? 'warning' : 'error'
				);
			} finally {
				if (generationRevision === state.generationRevision) {
					setExportBusy(false);
				}
			}
		}

		function applyTransformations(r, g, b, quantizeOutput = true) {
			return LUTCore.transformRgb(r, g, b, getTransformOptions(quantizeOutput));
		}

		function transformLutImageData(imageData) {
			const data = imageData.data;
			const transformOptions = getTransformOptions(true);

			for (let index = 0; index < data.length; index += 4) {
				const [r, g, b] = LUTCore.transformRgb(
					data[index],
					data[index + 1],
					data[index + 2],
					transformOptions
				);
				data[index] = r;
				data[index + 1] = g;
				data[index + 2] = b;
			}

			return imageData;
		}

		async function generate2dPngLUT(lutCanvas, lutCtx) {
			const lutSize = 512;
			lutCanvas.width = lutSize;
			lutCanvas.height = lutSize;

			if (state.useBackgroundProcessing && typeof Worker !== 'undefined') {
				const response = await runWorkerTask(
					'exportWorker',
					{ type: 'generateObsLut', options: getTransformOptions(true) },
					[],
					progress => updateProgress('export', progress)
				);
				const transformed = new ImageData(
					new Uint8ClampedArray(response.buffer),
					response.width,
					response.height
				);
				lutCtx.putImageData(transformed, 0, 0);
				logMessage('Generated and transformed the exact 512×512 OBS LUT layout', 'success');
				return;
			}

			const lutData = lutCtx.createImageData(lutSize, lutSize);
			const data = lutData.data;

			for (let y = 0; y < lutSize; y++) {
				for (let x = 0; x < lutSize; x++) {
					const [r, g, b] = LUTCore.neutralLutRgbAt(x, y);
					const index = (y * lutSize + x) * 4;
					data[index] = r;
					data[index + 1] = g;
					data[index + 2] = b;
					data[index + 3] = 255;
				}
			}

			updateProgress('export', 20);
			const transformed = await transformImageData(lutData, 'exportWorker');
			lutCtx.putImageData(transformed, 0, 0);
			updateProgress('export', 95);
			logMessage('Generated and transformed the exact 512×512 OBS LUT layout', 'success');
		}

		async function generate3dCubeLUT(lutCanvas, lutCtx) {
		  const size = state.lutSize || 32;

		  logMessage(`Generating ${size}×${size}×${size} CUBE LUT data...`, 'info');

		  if (state.useBackgroundProcessing && typeof Worker !== 'undefined') {
			const response = await runWorkerTask(
			  'exportWorker',
			  {
				type: 'generateCube',
				size,
				options: getTransformOptions(false),
				metadata: { title: state.cubeTitle }
			  },
			  [],
			  progress => updateProgress('export', progress)
			);
			state.cubeData = response.data;
		  } else {
			state.cubeData = LUTCore.generateCubeData(
			  size,
			  getTransformOptions(false),
			  progress => updateProgress('export', progress),
			  { title: state.cubeTitle }
			);
		  }
		  generateCubePreview(lutCanvas, lutCtx);
		  return state.cubeData;
		}

		// Generate a visual representation for the CUBE LUT preview
		function generateCubePreview(lutCanvas, lutCtx) {
		  // Set canvas dimensions for preview
		  lutCanvas.width = 512;
		  lutCanvas.height = 530;
		  lutCtx.clearRect(0, 0, lutCanvas.width, lutCanvas.height);

		  // Display size info and create a visual representation
		  lutCtx.fillStyle = '#f8f8f8';
		  lutCtx.fillRect(0, 0, lutCanvas.width, lutCanvas.height);

		  // Draw header info
		  lutCtx.fillStyle = '#333333';
		  lutCtx.font = 'bold 24px sans-serif';
		  lutCtx.fillText(`CUBE LUT (${state.lutSize}×${state.lutSize}×${state.lutSize})`, 40, 40);

		  // Draw file info
		  lutCtx.font = '16px monospace';
		  const previewTitle = state.cubeTitle.replace(/[\r\n]+/g, ' ').replace(/"/g, "'").trim().slice(0, 42) || 'Custom LUT';
		  lutCtx.fillText(`TITLE "${previewTitle}"`, 40, 70);
		  lutCtx.fillText(`LUT_3D_SIZE ${state.lutSize}`, 40, 95);

		  // Draw a grid representation - slightly smaller and positioned higher
		  const gridSize = Math.min(16, state.lutSize); // Limit grid lines for cleaner visual
		  const cellSize = 280 / gridSize;
		  const startX = 116;
		  const startY = 120;

		  // Draw grid borders
		  lutCtx.strokeStyle = '#666666';
		  lutCtx.lineWidth = 1;

		  // Draw X-Y plane
		  lutCtx.strokeRect(startX, startY, 280, 280);

		  // Draw some sample lines to represent the 3D grid
		  lutCtx.lineWidth = 0.5;
		  for (let i = 1; i < gridSize; i++) {
			// X-Y plane horizontal lines
			lutCtx.beginPath();
			lutCtx.moveTo(startX, startY + i * cellSize);
			lutCtx.lineTo(startX + 280, startY + i * cellSize);
			lutCtx.stroke();

			// X-Y plane vertical lines
			lutCtx.beginPath();
			lutCtx.moveTo(startX + i * cellSize, startY);
			lutCtx.lineTo(startX + i * cellSize, startY + 280);
			lutCtx.stroke();
		  }

		  // Indicate file is ready for download
		  lutCtx.font = 'bold 18px sans-serif';
		  lutCtx.fillStyle = '#009900';
		  lutCtx.fillText('CUBE file ready for download!', 156, 420);

		  // Draw legend with sample colors - moved higher up
		  lutCtx.fillStyle = '#333333';
		  lutCtx.font = 'bold 16px sans-serif';
		  lutCtx.fillText('Sample Color Transformations:', 40, 440);

		  // Draw sample color squares with transformations
		  const sampleColors = [
			[0, 0, 0],      // Black
			[255, 0, 0],    // Red
			[0, 255, 0],    // Green
			[0, 0, 255],    // Blue
			[255, 255, 0],  // Yellow
			[255, 0, 255],  // Magenta
			[0, 255, 255],  // Cyan
			[255, 255, 255] // White
		  ];

		  const colorNames = ['Black', 'Red', 'Green', 'Blue', 'Yellow', 'Magenta', 'Cyan', 'White'];

		  // Draw original and transformed color pairs - reorganized in two rows
		  for (let i = 0; i < sampleColors.length; i++) {
			// Position in two rows of 4 items
			const x = 40 + (i % 4) * 120;
			const y = 460 + Math.floor(i / 4) * 40;

			const [r, g, b] = sampleColors[i];

			// Draw original color
			lutCtx.fillStyle = `rgb(${r},${g},${b})`;
			lutCtx.fillRect(x, y, 15, 15);

			// Apply transformation
			const transformedColor = applyTransformations(r, g, b, true);

			// Ensure valid RGB values
			const [tR, tG, tB] = transformedColor.map(v => Math.min(255, Math.max(0, Math.round(v))));

			// Draw transformed color
			lutCtx.fillStyle = `rgb(${tR},${tG},${tB})`;
			lutCtx.fillRect(x + 25, y, 15, 15);

			// Draw label
			lutCtx.fillStyle = '#333333';
			lutCtx.font = '12px sans-serif';
			lutCtx.fillText(colorNames[i], x + 50, y + 12);
		  }
		}

        function downloadLUT() {
		  if (state.isGeneratingLUT) {
			logMessage('Please wait for LUT generation to finish', 'warning');
			return;
		  }

		  const safeTitle = state.cubeTitle.trim().toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'custom-lut';

		  if (state.lutFormat === 'png' && state.lutImage) {
			const lutCanvas = document.getElementById('lut-preview');

			// Download the LUT as PNG
			const dataURL = lutCanvas.toDataURL('image/png');
			const a = document.createElement('a');
			a.href = dataURL;
			a.download = 'custom-lut.png';
			document.body.appendChild(a);
			a.click();
			a.remove();

			logMessage('LUT downloaded successfully!', 'success');
		  } else if (state.lutFormat === 'cube' && state.cubeData) {
			// Create blob from cube data
			const blob = new Blob([state.cubeData], { type: 'text/plain;charset=utf-8' });
			const url = URL.createObjectURL(blob);

			// Create temporary link and trigger download
			const a = document.createElement('a');
			a.href = url;
			a.download = `${safeTitle}.cube`;
			document.body.appendChild(a); // Need to append to body for Firefox
			a.click();
			document.body.removeChild(a); // Clean up
			URL.revokeObjectURL(url);

			logMessage('CUBE file downloaded successfully!', 'success');
		  } else {
			logMessage('No LUT data available for download', 'error');
		  }
		}

        // Initialize additional event listeners
        function initializeEventListeners() {
            document.getElementById('advanced-processing-toggle').addEventListener('change', function() {
				state.useAdvancedProcessing = this.checked;
				invalidateGeneratedLUT();
				if (state.qualityMetrics) {
					renderQualityReport();
				}
				if (state.testImage) {
					processTestImage();
				}
				logMessage(`Advanced processing ${this.checked ? 'enabled' : 'disabled'}`, 'info');
			});

			document.getElementById('rolloff-curves-toggle').addEventListener('change', function() {
				state.applyRolloffCurves = this.checked;
				invalidateGeneratedLUT();
				if (state.testImage) {
					processTestImage();
				}
				logMessage(`Shadow/highlight rolloff ${this.checked ? 'enabled' : 'disabled'}`, 'info');
			});

			document.getElementById('weighted-regression-toggle').addEventListener('change', function() {
				state.useWeightedRegression = this.checked;
				invalidateTransformation();
				logMessage(`Weighted regression ${this.checked ? 'enabled' : 'disabled'}; process the color transformation again`, 'info');
			});

			document.getElementById('regression-solver').addEventListener('change', function() {
				state.regressionSolver = this.value;
				invalidateTransformation();
				logMessage(
					`${this.value === 'qr' ? 'QR' : 'Notebook-compatible'} regression selected; process the color transformation again`,
					'info'
				);
			});

			const backgroundToggle = document.getElementById('background-processing-toggle');
			if (typeof Worker === 'undefined') {
				backgroundToggle.checked = false;
				backgroundToggle.disabled = true;
				state.useBackgroundProcessing = false;
				backgroundToggle.parentElement.title = 'Background workers are not supported by this browser';
			}
			backgroundToggle.addEventListener('change', function() {
				state.useBackgroundProcessing = this.checked;
				terminateWorker('previewWorker', 'Preview processing mode changed');
				if (state.isGeneratingLUT) {
					invalidateGeneratedLUT();
				}
				if (state.testImage && state.transformationModels.basic.red) {
					processTestImage();
				}
				logMessage(`Background processing ${this.checked ? 'enabled' : 'disabled'}`, 'info');
			});
        }

		        // Display the test image
        function displayTestImage(img) {
            // Original image
            const originalCanvas = document.getElementById('test-original');
            const originalCtx = originalCanvas.getContext('2d');

            // Set canvas size
            const maxWidth = 1280;
            const scale = Math.min(1, maxWidth / img.width);
            originalCanvas.width = img.width * scale;
            originalCanvas.height = img.height * scale;

            // Draw original image
            originalCtx.drawImage(img, 0, 0, originalCanvas.width, originalCanvas.height);

            // Processed image (initial version is same as original)
            const processedCanvas = document.getElementById('test-processed');
            const processedCtx = processedCanvas.getContext('2d');

            processedCanvas.width = originalCanvas.width;
            processedCanvas.height = originalCanvas.height;
            processedCtx.drawImage(img, 0, 0, processedCanvas.width, processedCanvas.height);

            // Process the test image
            processTestImage();
        }

        // Load a demo image
		function loadDemoImage(type) {
			const demoUrl = type === 'colorcard'
				? 'logcrop.jpg'
				: 'log.jpg';

			logMessage(`Loading demo ${type} image...`, 'info');

			fetch(demoUrl)
				.then(response => {
					if (!response.ok) {
						throw new Error(`Failed to load demo image: ${response.status} ${response.statusText}`);
					}
					return response.blob();
				})
				.then(blob => {
					const file = new File([blob], `demo-${type}.jpg`, { type: 'image/jpeg' });
					loadImage(file, type); // Pass the correct type parameter
				})
				.catch(error => {
					logMessage(`Error loading demo image: ${error.message}`, 'error');
				});
		}

        // Display the color card image and extract colors
        function displayColorCardImage(img) {
            const canvas = document.getElementById('colorcard-preview');

            // Set canvas size
            const maxWidth = 600;
            const scale = Math.min(1, maxWidth / img.width);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;

            drawColorCardOverlay();

            // Show image info
            const info = document.getElementById('colorcard-info');
            info.textContent = `Image loaded: ${img.width}×${img.height} pixels`;

            // Extract colors from the image
            extractColorsFromImage(img);
        }

		// Initialize test image upload
        function initializeTestImageUpload() {
           const testFileInput = document.getElementById('test-upload');
		   if (testFileInput) {
			testFileInput.addEventListener('change', function(event) {
			  const file = event.target.files[0];
			  if (file) {
				loadImage(file, 'test');
			  }
			});
		  }

		  document.getElementById('use-demo-test').addEventListener('click', function() {
			loadDemoImage('test');
		  });
        }

		function createMetricCard(label, value) {
			const card = document.createElement('div');
			card.className = 'quality-card';
			const heading = document.createElement('strong');
			heading.textContent = label;
			const measurement = document.createElement('span');
			measurement.textContent = value;
			card.append(heading, measurement);
			return card;
		}

		function renderQualityReport() {
			if (!state.qualityMetrics) {
				return;
			}
			const report = document.getElementById('quality-report');
			const summary = document.getElementById('quality-summary');
			const swatchContainer = document.getElementById('quality-swatches');
			summary.replaceChildren();
			swatchContainer.replaceChildren();

			const recommendation = document.createElement('p');
			recommendation.className = 'quality-recommendation';
			const recommendedName = state.qualityMetrics.recommendedMode === 'advanced' ? 'Advanced' : 'Basic';
			recommendation.textContent = `${recommendedName} mode has the lower chart-fit color error. This is an in-sample diagnostic, so confirm the choice with a separate test image.`;
			summary.appendChild(recommendation);

			for (const metrics of [state.qualityMetrics.basic, state.qualityMetrics.advanced].filter(Boolean)) {
				const heading = document.createElement('h4');
				heading.textContent = `${metrics.mode === 'advanced' ? 'Advanced' : 'Basic'} model${metrics.mode === (state.useAdvancedProcessing ? 'advanced' : 'basic') ? ' (selected)' : ''}`;
				const grid = document.createElement('div');
				grid.className = 'quality-metrics';
				grid.append(
					createMetricCard('Mean ΔE76', metrics.meanDeltaE.toFixed(2)),
					createMetricCard('Maximum ΔE76', metrics.maxDeltaE.toFixed(2)),
					createMetricCard('RGB RMSE', metrics.rgbRmse.toFixed(2)),
					createMetricCard('Out-of-range channels', `${metrics.clippedPercent.toFixed(1)}%`)
				);
				summary.append(heading, grid);
			}

			const activeMetrics = state.useAdvancedProcessing && state.qualityMetrics.advanced
				? state.qualityMetrics.advanced
				: state.qualityMetrics.basic;
			activeMetrics.swatches.forEach(swatch => {
				const row = document.createElement('div');
				row.className = 'quality-swatch';
				row.title = `Captured ${swatch.captured.join(', ')}; target ${swatch.target.join(', ')}; predicted ${swatch.predicted.map(value => Math.round(value)).join(', ')}`;
				const targetColor = document.createElement('span');
				targetColor.className = 'quality-swatch-color';
				targetColor.style.backgroundColor = rgbToHex(swatch.target);
				targetColor.setAttribute('aria-label', `Target color ${swatch.index + 1}`);
				const predictedColor = document.createElement('span');
				predictedColor.className = 'quality-swatch-color';
				predictedColor.style.backgroundColor = rgbToHex(swatch.predicted.map(value => Math.round(Math.max(0, Math.min(255, value)))));
				predictedColor.setAttribute('aria-label', `Predicted color ${swatch.index + 1}`);
				const label = document.createElement('span');
				label.textContent = `Patch ${swatch.index + 1}: ΔE ${swatch.deltaE.toFixed(2)}${swatch.clipped ? ' · clipped' : ''}`;
				row.append(targetColor, predictedColor, label);
				swatchContainer.appendChild(row);
			});

			report.hidden = false;
		}

        // Regression and rolloff helpers are implemented in lut-core.js.
		function processColorTransformation() {
			refreshColorExtraction.flush();
			logMessage('Starting color transformation processing...', 'info');

			if (state.capturedColors.length === 0) {
				logMessage('No captured colors found. Please upload a color card image first.', 'error');
				return;
			}

			if (state.referenceColors.length === 0) {
				logMessage('No reference colors defined. Please set up your reference colors first.', 'error');
				return;
			}

			if (state.capturedColors.length !== state.referenceColors.length) {
				logMessage('Captured and reference color counts do not match. Recheck the grid configuration.', 'error');
				return;
			}

			try {
				updateProgress('process', 10);
				state.transformationModels = LUTCore.buildTransformationModels(
					state.capturedColors,
					state.referenceColors,
					{
						polynomialDegree: state.polynomialDegree,
						multivariateDegree: 2,
						useWeightedRegression: state.useWeightedRegression,
						regressionSolver: state.regressionSolver
					}
				);
				state.rolloffCurves = LUTCore.generateRolloffCurves();
				state.qualityMetrics = LUTCore.evaluateTransformationModels(
					state.capturedColors,
					state.referenceColors,
					state.transformationModels
				);
				renderQualityReport();
				updateProgress('process', 90);
				logMessage(`Basic and advanced color models calculated with the ${state.regressionSolver === 'qr' ? 'QR' : 'notebook-compatible'} solver`, 'info');

				updateProgress('process', 100);
				logMessage(`Color transformation processing complete!${state.useAdvancedProcessing ? ' (Advanced mode)' : ''}`, 'success');

				document.getElementById('process-next').disabled = false;
				invalidateGeneratedLUT();

				if (state.testImage) {
					processTestImage();
				}
			} catch (error) {
				invalidateTransformation();
				updateProgress('process', 0);
				logMessage(`Error processing color transformation: ${error.message}`, 'error');
			}
		}
