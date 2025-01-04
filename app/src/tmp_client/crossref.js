var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};
class BookCrossref {
  constructor(data) {
    __publicField(this, "_data");
    this._data = data;
  }
  // Get cross-references for given verse of book
  get_refs(chapter, verse) {
    var _a, _b, _c;
    return (_c = (_b = (_a = this._data[chapter]) == null ? void 0 : _a[verse]) == null ? void 0 : _b.map((ref) => {
      var _a2, _b2;
      return {
        book: ref[0],
        start_chapter: ref[1],
        start_verse: ref[2],
        end_chapter: (_a2 = ref[3]) != null ? _a2 : ref[1],
        end_verse: (_b2 = ref[4]) != null ? _b2 : ref[2],
        single_verse: !!ref[2] && ref[3] === void 0
      };
    })) != null ? _c : [];
  }
}
export {
  BookCrossref
};
//# sourceMappingURL=crossref.js.map
