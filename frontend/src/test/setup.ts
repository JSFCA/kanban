import "@testing-library/jest-dom";

// jsdom implements no layout, so it has no scrollIntoView. The chat thread
// scrolls itself on every new turn; without this every render throws.
Element.prototype.scrollIntoView = () => {};
