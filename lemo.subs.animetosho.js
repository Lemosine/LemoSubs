// Keep the installed extension ID updateable without contacting the retired feed.
export default new class RetiredAnimeTosho {
  async test() {
    throw new Error("AnimeTosho retired its feed/API in October 2026. Disable the AnimeTosho (Retired) extension and use the other sources.");
  }

  async single() { return []; }
  async batch() { return []; }
  async movie() { return []; }
}();
