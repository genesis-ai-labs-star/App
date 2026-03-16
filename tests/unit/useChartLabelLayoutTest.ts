import type {SkFont} from '@shopify/react-native-skia';
import {renderHook} from '@testing-library/react-native';
import {useChartLabelLayout} from '@components/Charts/hooks/useChartLabelLayout';
import type {ChartDataPoint} from '@components/Charts/types';

/** Each glyph = 7px wide, so widths are deterministic. */
const PX_PER_CHAR = 7;

function createMockFont(): SkFont {
    return {
        getMetrics: () => ({ascent: -12, descent: 4, leading: 0}),
        getGlyphIDs: (text: string) => [...text].map((_, i) => i + 1),
        getGlyphWidths: (glyphIDs: number[]) => glyphIDs.map(() => PX_PER_CHAR),
        getSize: () => 12,
    } as unknown as SkFont;
}

function makeData(...labels: string[]): ChartDataPoint[] {
    return labels.map((label, i) => ({label, total: (i + 1) * 100}));
}

/** lineHeight = |ascent(12)| + |descent(4)| = 16 */
const LINE_HEIGHT = 16;

describe('useChartLabelLayout', () => {
    const font = createMockFont();

    describe('skip interval', () => {
        it('returns skip interval 1 for 16 categories when lineHeight fits within tick spacing (Android #84537)', () => {
            // Reproduces issue #84537: Redmi Note 10S Android 13 showed only ~8 of 16 labels.
            // barAreaWidth ≈ 288dp → tickSpacing = 288 / 16 = 18dp.
            // lineHeight = 16 (ascent:12 + descent:4) → 16 ≤ 18 → each label fits its slot.
            //
            // Old code: maxVisibleCount(288, 16) = floor(288 / (16+4)) = 14 < 16
            //           → skip = ceil(16/14) = 2 → only 8 labels shown (bug).
            // Fixed:    verticalWidth(16) ≤ tickSpacing(18) → skip = 1 → all 16 shown.
            const labels = Array.from({length: 16}, (_, i) => `L${String(i).padStart(4, '0')}`);
            const {result} = renderHook(() =>
                useChartLabelLayout({
                    data: makeData(...labels),
                    font,
                    tickSpacing: 18,
                    labelAreaWidth: 288,
                }),
            );
            // Labels are too wide for 0° and 45° at tickSpacing=18, so rotation falls back to 90°.
            // The hook returns -rotation, so 90° → -90.
            expect(result.current.labelRotation).toBe(-90);
            expect(result.current.labelSkipInterval).toBe(1);
        });

        it('returns skip interval > 1 at 90° when labels genuinely cannot fit even at 90°', () => {
            // lineHeight(16) > tickSpacing(10) → else branch → maxVisibleCount(100, 16)=5 → skip=2
            const labels = Array.from({length: 10}, (_, i) => `L${String(i).padStart(4, '0')}`);
            const {result} = renderHook(() =>
                useChartLabelLayout({
                    data: makeData(...labels),
                    font,
                    tickSpacing: 10,
                    labelAreaWidth: 100,
                }),
            );
            expect(result.current.labelRotation).toBe(-90);
            expect(result.current.labelSkipInterval).toBe(2);
        });

        it('returns xAxisLabelHeight matching the longest label text width at 90°', () => {
            // "AAAAAA" = 6*7 = 42px. At 90°, effectiveHeight = labelWidth = 42.
            const {result} = renderHook(() =>
                useChartLabelLayout({
                    data: makeData('AAAAAA', 'BBBBBB'),
                    font,
                    tickSpacing: 10,
                    labelAreaWidth: 400,
                }),
            );
            expect(result.current.labelRotation).toBe(-90);
            expect(result.current.labelSkipInterval).toBe(1);
            expect(result.current.xAxisLabelHeight).toBe(42);
        });
    });

    describe('rotation selection', () => {
        it('picks 0° when labels fit horizontally', () => {
            // "AAA" = 21px. 21+4=25 ≤ tickSpacing(30). maxVisibleCount(90,21)=3 ≥ 3.
            const {result} = renderHook(() =>
                useChartLabelLayout({
                    data: makeData('AAA', 'BBB', 'CCC'),
                    font,
                    tickSpacing: 30,
                    labelAreaWidth: 90,
                }),
            );
            expect(result.current.labelRotation).toBe(0);
            expect(result.current.labelSkipInterval).toBe(1);
        });

        it('picks 45° when labels overflow horizontally but fit diagonally', () => {
            // "AAAAAA" = 42px. 42+4=46 > tickSpacing(40) → 0° fails.
            // 45°: 42*SIN_45 ≈ 29.7, 29.7+4=33.7 ≤ 40 ✓
            const {result} = renderHook(() =>
                useChartLabelLayout({
                    data: makeData('AAAAAA', 'BBBBBB'),
                    font,
                    tickSpacing: 40,
                    labelAreaWidth: 400,
                }),
            );
            expect(result.current.labelRotation).toBe(-45);
        });

        it('picks 90° when labels overflow at all rotations', () => {
            // tickSpacing=20: 0° fails (46>20), 45° fails (29.7+4=33.7>20) → 90°
            const {result} = renderHook(() =>
                useChartLabelLayout({
                    data: makeData('AAAAAA', 'BBBBBB'),
                    font,
                    tickSpacing: 20,
                    labelAreaWidth: 400,
                }),
            );
            expect(result.current.labelRotation).toBe(-90);
        });
    });

    describe('label truncation', () => {
        it('truncates labels at 45° to fit tick spacing', () => {
            // tickSpacing=30. maxLabelWidth = (30-4)/SIN_45 ≈ 36.7px → truncate "AAAAAAAAAAAA" (12 chars=84px)
            const {result} = renderHook(() =>
                useChartLabelLayout({
                    data: makeData('AAAAAAAAAAAA', 'BBBBBB'),
                    font,
                    tickSpacing: 30,
                    labelAreaWidth: 300,
                }),
            );
            expect(result.current.labelRotation).toBe(-45);
            expect(result.current.truncatedLabels.at(0)).toMatch(/\.\.\.$/);
        });
    });

    describe('early returns', () => {
        it('returns defaults when font is null', () => {
            const {result} = renderHook(() =>
                useChartLabelLayout({
                    data: makeData('A', 'B'),
                    font: null,
                    tickSpacing: 50,
                    labelAreaWidth: 100,
                }),
            );
            expect(result.current).toEqual({labelRotation: 0, labelSkipInterval: 1, truncatedLabels: []});
        });

        it('returns defaults when data is empty', () => {
            const {result} = renderHook(() =>
                useChartLabelLayout({data: [], font, tickSpacing: 50, labelAreaWidth: 100}),
            );
            expect(result.current).toEqual({labelRotation: 0, labelSkipInterval: 1, truncatedLabels: []});
        });
    });
});
