/** Every element the client touches, resolved once. */

const find = selector => document.querySelector(selector);

export const mapCanvas = find('#hex-map');
export const cellElement = find('#cell');
export const soundElement = find('#sound');
export const noticeElement = find('#notice');
export const whisperElement = find('#whisper');
export const startupElement = find('#startup-state');
export const intro = find('#intro');
export const startButton = find('#start');
export const reticle = find('#reticle');

export const searchButton = find('#open-search');
export const searchPanel = find('#search-panel');
export const searchInput = find('#search-input');
export const searchSubmit = find('#search-submit');
export const addressInput = find('#address-input');
export const addressSubmit = find('#address-submit');
export const searchResult = find('#search-result');
export const closeSearchButton = find('#close-search');

export const atlasButton = find('#open-atlas');
export const atlasPanel = find('#atlas-panel');
export const atlasCanvas = find('#atlas');
export const atlasLevel = find('#atlas-level');
export const atlasHint = find('#atlas-hint');
export const closeAtlasButton = find('#close-atlas');

export const registerButton = find('#open-register');
export const registerPanel = find('#register-panel');
export const registerBody = find('#register-body');
export const registerCount = find('#register-count');
export const registerNote = find('#register-note');
export const closeRegisterButton = find('#close-register');

export const bookPanel = find('#book-panel');
export const bookTitle = find('#book-title');
export const bookAddress = find('#book-address');
export const locationRecord = find('#location-record');
export const catalogueRecord = find('#catalogue-record');
export const bookPage = find('#book-page');
export const pageNumber = find('.page-counter span');
export const pageTotal = find('#page-total');
export const previousPage = find('#previous-page');
export const nextPage = find('#next-page');
export const closeBookButton = find('#close-book');
