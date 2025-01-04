import { PassageReference } from '@gracious.tech/bible-references';
import { BibleBook, BibleBookHtml, BibleBookUsx, BibleBookUsfm, BibleBookTxt } from './book.js';
import { TranslationExtra } from './translation.js';
import type { BookNames, DistManifest, OneOrMore, TranslationLiteralness, TranslationTag } from './shared_types';
import type { UsageOptions, UsageConfig, RuntimeManifest, RuntimeLicense } from './types';
type ObjT<T> = Omit<T, 'object'> & {
    object: true;
};
type ObjF<T> = Omit<T, 'object'> & {
    object?: false;
};
export interface GetLanguagesOptions {
    object?: boolean;
    exclude_old?: boolean;
    sort_by?: 'local' | 'english' | 'population' | 'population_L1';
    search?: string;
}
export interface GetLanguagesItem {
    code: string;
    name_local: string;
    name_english: string;
    name_bilingual: string;
    population: number | null;
}
export interface GetTranslationsOptions {
    language?: string;
    object?: boolean;
    sort_by_year?: boolean;
    usage?: UsageOptions;
    exclude_obsolete?: boolean;
    exclude_incomplete?: boolean;
}
export interface GetTranslationsItem {
    id: string;
    language: string;
    direction: 'ltr' | 'rtl';
    year: number;
    attribution: string;
    attribution_url: string;
    licenses: RuntimeLicense[];
    tags: TranslationTag[];
    liternalness: TranslationLiteralness;
    name: string;
    name_abbrev: string;
    name_english: string;
    name_english_abbrev: string;
    name_local: string;
    name_local_abbrev: string;
    name_bilingual: string;
    name_bilingual_abbrev: string;
}
export interface GetBooksOptions {
    object?: boolean;
    sort_by_name?: boolean;
    testament?: 'ot' | 'nt';
    whole?: boolean;
}
export interface GetBooksItem {
    id: string;
    ot: boolean;
    nt: boolean;
    available: boolean;
    name: string;
    name_abbrev: string;
    name_english: string;
    name_english_abbrev: string;
    name_local: string;
    name_local_abbrev: string;
    name_local_long: string;
    name_bilingual: string;
    name_bilingual_abbrev: string;
}
export interface GetCompletionReturn {
    ot: {
        available: string[];
        missing: string[];
    };
    nt: {
        available: string[];
        missing: string[];
    };
}
export declare class BibleCollection {
    _usage: UsageConfig;
    _remember_fetches: boolean;
    _fetch_book_cache: Record<string, Promise<BibleBook>>;
    _fetch_extras_cache: Record<string, Promise<TranslationExtra>>;
    _local_book_names: Record<string, Record<string, BookNames>>;
    _manifest: RuntimeManifest;
    _endpoints: Record<string, string>;
    _modern_year: number;
    constructor(usage: UsageConfig, remember_fetches: boolean, manifests: OneOrMore<[string, DistManifest]>);
    _ensure_trans_exists(translation: string): void;
    _ensure_book_exists(translation: string, book: string): void;
    has_language(language: string): boolean;
    has_translation(translation: string): boolean;
    has_book(translation: string, book: string): boolean;
    get_languages(options: ObjT<GetLanguagesOptions>): Record<string, GetLanguagesItem>;
    get_languages(options?: ObjF<GetLanguagesOptions>): GetLanguagesItem[];
    get_preferred_language(preferences?: string[]): string;
    get_translations(options: ObjT<GetTranslationsOptions>): Record<string, GetTranslationsItem>;
    get_translations(options?: ObjF<GetTranslationsOptions>): GetTranslationsItem[];
    get_preferred_translation(languages?: string[]): string;
    get_books(translation: string | undefined, options: ObjT<GetBooksOptions>): Record<string, GetBooksItem>;
    get_books(translation?: string, options?: ObjF<GetBooksOptions>): GetBooksItem[];
    get_book_url(translation: string, book: string, format?: 'html' | 'usx' | 'usfm' | 'txt'): string;
    get_completion(translation: string): GetCompletionReturn;
    fetch_book(translation: string, book: string, format?: 'html'): Promise<BibleBookHtml>;
    fetch_book(translation: string, book: string, format: 'usx'): Promise<BibleBookUsx>;
    fetch_book(translation: string, book: string, format: 'usfm'): Promise<BibleBookUsfm>;
    fetch_book(translation: string, book: string, format: 'txt'): Promise<BibleBookTxt>;
    fetch_translation_extras(translation: string): Promise<TranslationExtra>;
    _from_string_args(translation?: string | string[], always_detect_english?: boolean): [[string, string][], string[], number, boolean];
    detect_references(text: string, translation?: string | string[], always_detect_english?: boolean): Generator<import("@gracious.tech/bible-references").PassageReferenceMatch, null, undefined>;
    string_to_reference(text: string, translation?: string | string[], always_detect_english?: boolean): PassageReference | null;
    reference_to_string(reference: PassageReference, translation?: string, abbreviate?: boolean): string;
}
export {};
