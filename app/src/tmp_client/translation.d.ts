import type { DistTranslationExtra } from './shared_types';
export declare class TranslationExtra {
    _extra: DistTranslationExtra;
    constructor(extra: DistTranslationExtra);
    _ensure_book_exists(book: string): void;
    get_book_name(book: string): {
        normal: string;
        long: string;
        abbrev: string;
    };
    get_chapters(book: string): {
        number: number;
        heading: string;
    }[];
    get_chapter_heading(book: string, chapter: number): string;
    get_sections(book: string): {
        heading: string;
        start_chapter: number;
        start_verse: number;
        end_chapter: number;
        end_verse: number;
    }[];
}
