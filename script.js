// ==UserScript==
// @name         Metabase doubleclick selector
// @namespace    mb-legend-isolate
// @version      3.0.1
// @description  Double-click on legend item -> hide others or show them back
// @author       DarkPatrick
// @match        INSERT YOUR METABASE DOMAIN HERE
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const VIS_ROOT_SELECTOR = 'div[data-element-id="dashboard-cards-container"]';
    const VIS_QUERY_ROOT_SELECTOR = 'div[data-testid="query-builder-root"]';
    const CARD_SELECTOR = 'div[data-testid="visualization-root"]';
    const BUTTON_SELECTOR = 'button[aria-label]';
    const DROPDOWN_BUTTON_SELECTOR = 'div[aria-haspopup="dialog"]';
    const DROPDOWN_POPOVER_SELECTOR = 'div[data-element-id="mantine-popover"]';



    function clickElement(element) {
        if (!element) return;
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }


    function collectButtons(buttons, dialog, fromDropdown = false) {
        for (let i = buttons.length - 1; i >= 0; i--) {
            const btn = buttons[i];
            if (!btn.isConnected) {
                buttons.splice(i, 1);
            }
        }

        const newButtons = dialog.querySelectorAll(BUTTON_SELECTOR);
        newButtons.forEach(btn => {
            if (!buttons.includes(btn)) {
                buttons.push(btn);
            }
        });
    }


    function waitForElement(selector, timeout = 2000, interval = 50) {
        return new Promise((resolve, reject) => {
            const start = Date.now();

            function check() {
                const el = document.querySelector(selector);
                if (el) {
                    return resolve(el);
                }
                if (Date.now() - start >= timeout) {
                    return reject(new Error('Element not found within timeout'));
                }

                setTimeout(check, interval);
            }

            check();
        });
    }


    function addDoubleClickHandlerToButtons(card, buttons, fromDropdown = false) {
        buttons.forEach(async button => {
            if (button.dataset.dashcardDblclickAttached === '1') return;
            button.dataset.dashcardDblclickAttached = '1';

            button.addEventListener('dblclick', async function (e) {
                // prevent onclick from firing
                // doesn't work anyway)
                e.stopPropagation();
                e.preventDefault();
                const originalLabel = button.getAttribute('aria-label');

                const allButtons = Array.from(
                    card.querySelectorAll(BUTTON_SELECTOR)
                );

                const dialogDiv = card.querySelector(DROPDOWN_BUTTON_SELECTOR);
                if (dialogDiv && /And \d+ more/.test(dialogDiv.textContent)) {
                    if (!fromDropdown) {
                        clickElement(dialogDiv);
                    }

                    try {
                        const dialog = await waitForElement(DROPDOWN_POPOVER_SELECTOR, 2000, 50);
                        collectButtons(allButtons, dialog);

                    } catch (error) {
                        console.warn('Error waiting for dialog:', error);
                    }
                }

                const otherButtons = allButtons.filter(b => b !== button);
                const allOthersShow = otherButtons.length > 0 &&
                    otherButtons.every(
                        b => b.getAttribute('aria-label') === 'Show series'
                    );

                if (allOthersShow) {
                    otherButtons.forEach(b => {
                        if (b.getAttribute('aria-label') === 'Show series') {
                            b.click();
                        }
                    });
                    if (!fromDropdown) {
                        clickElement(dialogDiv);
                    }
                } else {
                    if (originalLabel === 'Show series') {
                        // стрёмный костыль, чтобы дождаться прока дефолтнный обработчик клика сработал
                        const intervalId = setInterval(() => {
                            const currLabel = button.getAttribute('aria-label');
                            if (currLabel === 'Show series') {
                                button.click();
                                // стрёмный костыль в встрёмном костыле (всё ради кейса, когда выбран только один series, а юзер кликает по невыбранному)
                                setTimeout(() => {
                                    otherButtons.forEach(b => {
                                        if (b.getAttribute('aria-label') === 'Hide series') {
                                            b.click();
                                        }
                                    });
                                    if (!fromDropdown) {
                                        clickElement(dialogDiv);
                                    }
                                    clearInterval(intervalId);
                                }, 100);
                            }
                        }, 200);

                        setTimeout(() => clearInterval(intervalId), 2000);
                    } else {
                        otherButtons.forEach(b => {
                            if (b.getAttribute('aria-label') === 'Hide series') {
                                b.click();
                                if (!fromDropdown) {
                                    clickElement(dialogDiv);
                                }
                            }
                        });
                    }
                }
            });
        });
    }


    function attachDropdownHandlerToCard(card, buttons) {
        const dialogDiv = card.querySelector(DROPDOWN_BUTTON_SELECTOR);
        if (!dialogDiv) return;

        if (dialogDiv.dataset.dropdownHandlerAttached === '1') return;
        dialogDiv.dataset.dropdownHandlerAttached = '1';
        dialogDiv.addEventListener('click', async (event) => {
            const alreadyOpen = !!document.querySelector(DROPDOWN_POPOVER_SELECTOR);
            if (alreadyOpen || !event.isTrusted) {
                return;
            }

            try {
                const dialog = await waitForElement(DROPDOWN_POPOVER_SELECTOR, 2000, 50);
                collectButtons(buttons, dialog, true);

                addDoubleClickHandlerToButtons(card, buttons, true);
            } catch (error) {
                console.warn('Error waiting for dialog:', error);
            }
        });
    }


    function scanCardsForButtons(root) {
    const dashcards = root.querySelectorAll(CARD_SELECTOR);

    dashcards.forEach(card => {
        const buttonsNodeList = card.querySelectorAll(BUTTON_SELECTOR);
        if (!buttonsNodeList.length) return;

        const buttons = Array.from(buttonsNodeList);

        addDoubleClickHandlerToButtons(card, buttons);
        attachDropdownHandlerToCard(card, buttons);
    });
    }


    (async function attachDashcardDoubleClickHandlers() {
        let visRoot;
        try {
            if (window.location.pathname.includes('/question')) {
                visRoot = await waitForElement(VIS_QUERY_ROOT_SELECTOR, 30000, 100);
            } else if (window.location.pathname.includes('/dashboard') || window.location.pathname == '/') {
                visRoot = await waitForElement(VIS_ROOT_SELECTOR, 30000, 100);
            } else {
                console.warn('Not on a dashboard or question page, skipping dashcard double-click handler attachment.');
                return;
            }
        } catch (e) {
            console.warn('Visualization-root not found:', e);
            return;
        }

        scanCardsForButtons(visRoot);

        let pendingTimeout = null;
        function scheduleScan() {
            if (pendingTimeout !== null) return;
            pendingTimeout = setTimeout(() => {
                pendingTimeout = null;
                scanCardsForButtons(visRoot);
            }, 100);
        }

        const observer = new MutationObserver((mutations) => {
            scheduleScan();
        });

        observer.observe(visRoot, {
            childList: true,
            subtree: true,
        });
    })();
})();
