var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
import { books_ordered } from "@gracious.tech/bible-references";
class TranslationExtra {
  // @internal
  constructor(extra) {
    // @internal
    __publicField(this, "_extra");
    this._extra = extra;
  }
  // @internal
  _ensure_book_exists(book) {
    if (!books_ordered.includes(book)) {
      throw new Error(`Book id "${book}" is not valid (should be 3 letters lowercase)`);
    }
    if (!(book in this._extra.book_names)) {
      throw new Error(`Translation does not have book "${book}"`);
    }
  }
  // Get local name data for a book.
  // This will throw if the book doesn't exist or will contain empty strings if no data available.
  // You should call `get_books()` on the collection instance for more intuitive access.
  // It will automatically make use of local name data after fetching it.
  get_book_name(book) {
    this._ensure_book_exists(book);
    return {
      ...this._extra.book_names[book]
    };
  }
  // Get list of chapters for book which also includes a heading property for each
  get_chapters(book) {
    this._ensure_book_exists(book);
    return this._extra.chapter_headings[book].map((heading, number) => ({ number, heading })).slice(1);
  }
  // Get the heading for a specific chapter
  get_chapter_heading(book, chapter) {
    this._ensure_book_exists(book);
    return this._extra.chapter_headings[book][chapter];
  }
  // Get list of sections for a book which includes a heading for each and verse range
  get_sections(book) {
    this._ensure_book_exists(book);
    return this._extra.sections[book].map((section) => {
      var _a;
      const heading = (_a = section.heading) != null ? _a : this._extra.chapter_headings[book][section.start_chapter];
      return {
        ...section,
        heading
      };
    });
  }
}
export {
  TranslationExtra
};
//# sourceMappingURL=translation.js.map
