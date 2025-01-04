import { PassageReference } from '@gracious.tech/bible-references';
import type { RuntimeLicense, RuntimeCopyright } from './types';
import type { BibleJsonHtml, BibleJsonTxt } from './shared_types';
export interface GetPassageOptions {
    attribute?: boolean | RuntimeLicense;
}
export interface GetTxtOptions {
    attribute?: boolean | RuntimeLicense;
    verse_nums?: boolean;
    headings?: boolean;
    notes?: boolean;
}
export interface IndividualVerse<T> {
    id: number;
    chapter: number;
    verse: number;
    content: T;
}
export declare class BibleBookHtml {
    _copyright: RuntimeCopyright | undefined;
    _html: BibleJsonHtml;
    constructor(json: string, copyright?: RuntimeCopyright);
    get_attribution(license?: RuntimeLicense): string;
    _attribution(license: RuntimeLicense | boolean | undefined): string;
    get_whole({ attribute }?: GetPassageOptions): string;
    get_passage(start_chapter: number, start_verse: number, end_chapter: number, end_verse: number, options?: GetPassageOptions): string;
    get_passage_from_ref(ref: PassageReference, options?: GetPassageOptions): string;
    get_chapters(first: number, last: number, options?: GetPassageOptions): string;
    get_chapter(chapter: number, options?: GetPassageOptions): string;
    get_verse(chapter: number, verse: number, options?: GetPassageOptions): string;
    _get_list(start_chapter?: number, start_verse?: number, end_chapter?: number, end_verse?: number): IndividualVerse<string[]>[][];
    get_list(start_chapter?: number, start_verse?: number, end_chapter?: number, end_verse?: number): IndividualVerse<string>[];
    get_list_from_ref(ref: PassageReference): IndividualVerse<string>[];
}
export declare class BibleBookUsx {
    _copyright: RuntimeCopyright | undefined;
    _usx: string;
    constructor(usx: string, copyright?: RuntimeCopyright);
    get_whole(): string;
}
export declare class BibleBookUsfm {
    _copyright: RuntimeCopyright | undefined;
    _usfm: string;
    constructor(usfm: string, copyright?: RuntimeCopyright);
    get_whole(): string;
}
export declare class BibleBookTxt {
    _copyright: RuntimeCopyright | undefined;
    _txt: BibleJsonTxt;
    constructor(txt: string, copyright?: RuntimeCopyright);
    get_attribution(license?: RuntimeLicense): string;
    _attribution(license: RuntimeLicense | boolean | undefined): string;
    get_whole(options?: GetTxtOptions): string;
    get_passage(start_chapter: number, start_verse: number, end_chapter: number, end_verse: number, options?: GetTxtOptions): string;
    get_chapters(first: number, last: number, options?: GetTxtOptions): string;
    get_chapter(chapter: number, options?: GetTxtOptions): string;
    get_verse(chapter: number, verse: number, options?: GetTxtOptions): string;
}
export type BibleBook = BibleBookHtml | BibleBookTxt | BibleBookUsfm | BibleBookUsx;
