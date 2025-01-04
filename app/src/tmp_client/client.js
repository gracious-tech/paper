var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import { request } from "./utils.js";
import { BibleCollection } from "./collection.js";
import { BookCrossref } from "./crossref.js";
class BibleClient {
  // Create a new BibleClient, defaulting to the official fetch(bible) collection
  constructor(config = {}) {
    // @internal
    __publicField(this, "_endpoints");
    // @internal
    __publicField(this, "_data_endpoint");
    // @internal
    __publicField(this, "_usage", {
      commercial: false,
      attributionless: false,
      derivatives: false,
      limitless: true
      // Defaults to true since most apps will display entire bibles
    });
    // @internal
    __publicField(this, "_remember_fetches");
    // @internal
    __publicField(this, "_collection_promise");
    // @internal
    __publicField(this, "_crossref_cache", {});
    // Synchronous access to collection if it has already been fetched with `fetch_collection()`
    __publicField(this, "collection");
    var _a, _b;
    this._endpoints = (_a = config.endpoints) != null ? _a : ["https://collection.fetch.bible/"];
    this._data_endpoint = (_b = config.data_endpoint) != null ? _b : this._endpoints[0];
    this._usage = { ...this._usage, ...config.usage };
    this._remember_fetches = config.remember_fetches !== false;
  }
  // Fetch the collection's manifest and return a BibleCollection object for interacting with it
  async fetch_collection() {
    if (this._collection_promise) {
      return this._collection_promise;
    }
    this._collection_promise = Promise.all(this._endpoints.map(async (endpoint) => {
      return [
        endpoint,
        JSON.parse(await request(endpoint + "bibles/manifest.json"))
      ];
    })).then((manifests) => {
      this.collection = new BibleCollection(
        this._usage,
        this._remember_fetches,
        manifests
      );
      return this.collection;
    });
    this._collection_promise.catch(() => {
      this._collection_promise = void 0;
    });
    return this._collection_promise;
  }
  // Fetch cross-reference data for a book
  async fetch_crossref(book, size = "medium") {
    const key = `${book} ${size}`;
    if (key in this._crossref_cache) {
      return this._crossref_cache[key];
    }
    const url = this._data_endpoint + `crossref/${size}/${book}.json`;
    const promise = request(url).then((data) => {
      return new BookCrossref(JSON.parse(data));
    });
    if (this._remember_fetches) {
      this._crossref_cache[key] = promise;
      promise.catch(() => {
        delete this._crossref_cache[key];
      });
    }
    return promise;
  }
}
export {
  BibleClient
};
//# sourceMappingURL=client.js.map
