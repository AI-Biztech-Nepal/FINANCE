// lib/components/finance/PrintButton.tsx
import { useRef, type ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { printWithPreview } from '../../utils/exportWorkRecord';
import { exportReportXlsx, reportHtml, type PrintReport } from '../../utils/printReport';
import { showAlert, getErrorMessage } from '../../utils/alert';

/** A report's Print button. Pressing it opens the system's print preview (see printReportDocument)
 * - the pages as they will print, with the printer settings and Print / Cancel beside them. */
export function PrintButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Print"
      className="h-9 flex-row items-center justify-center rounded-lg border border-gray-300 bg-white px-3.5"
      style={{ gap: 6 }}
    >
      <Ionicons name="print-outline" size={16} color="#374151" />
      <Text className="text-[13px] font-semibold text-gray-700">Print</Text>
    </Pressable>
  );
}

/** A report's Excel button, beside Print: the same content, as a spreadsheet. */
export function ExcelButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Export to Excel"
      className="h-9 flex-row items-center justify-center rounded-lg border border-gray-300 bg-white px-3.5"
      style={{ gap: 6 }}
    >
      <Ionicons name="download-outline" size={16} color="#047857" />
      <Text className="text-[13px] font-semibold text-gray-700">Excel</Text>
    </Pressable>
  );
}

/** Opens a finished report document in the print preview. Nothing is printed until Print is pressed
 * in the preview. */
export async function printReportDocument(html: string) {
  try {
    await printWithPreview(html);
  } catch (err) {
    showAlert('Could not open the print preview', getErrorMessage(err));
  }
}

/** Downloads a report as an Excel file (the share sheet on a phone). */
export async function exportReportDocument(report: PrintReport) {
  try {
    await exportReportXlsx(report);
  } catch (err) {
    showAlert('Could not export', getErrorMessage(err));
  }
}

/** Print and Excel for a page - the pair every report carries in the top bar. The bar keeps the
 * callbacks it was first given, so `build` is read through a ref when a button is pressed: it always
 * prints the page as it is now. Put the returned buttons in the bar's `right`. */
export function useReportActions(build: () => PrintReport): ReactNode {
  const latest = useRef(build);
  latest.current = build;
  return (
    <>
      <PrintButton onPress={() => void printReportDocument(reportHtml(latest.current()))} />
      <ExcelButton onPress={() => void exportReportDocument(latest.current())} />
    </>
  );
}
