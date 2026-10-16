// lib/hooks/useScanBill.ts
import { useState } from 'react';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '../supabase';
import { showAlert, getErrorMessage } from '../utils/alert';
import { edgeFunctionErrorText } from '../utils/edgeFunctionError';

export interface ScannedBillItem {
  description: string;
  qty: number;
  rate: number;
}

export interface ScannedBill {
  vendor_name: string | null;
  amount: number | null;
  date: string | null;
  vat_amount: number | null;
  discount_amount: number | null;
  bill_no: string | null;
  note: string | null;
  items: ScannedBillItem[];
}

async function compressToBase64(uri: string): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: 1600 });
  const image = await context.renderAsync();
  const result = await image.saveAsync({ compress: 0.6, format: SaveFormat.JPEG, base64: true });
  if (!result.base64) throw new Error('Could not prepare that photo.');
  return result.base64;
}

/** Lets a Finance form fill itself from a photo of the actual bill/receipt
 * instead of the reseller typing everything by hand. The photo goes to the
 * scan-bill edge function (Gemini's vision model, so the API key never ships
 * in the app) and comes back as structured fields to drop into the form -
 * the reseller still reviews and can edit everything before saving, nothing
 * here ever submits on its own. */
export function useScanBill() {
  const [scanning, setScanning] = useState(false);

  async function scanFromUri(uri: string): Promise<ScannedBill | null> {
    setScanning(true);
    try {
      const base64 = await compressToBase64(uri);
      const { data, error } = await supabase.functions.invoke('scan-bill', {
        body: { image: base64, mimeType: 'image/jpeg' },
      });
      if (error || !data || data.error) {
        showAlert('Could not read that bill', data?.error ?? (await edgeFunctionErrorText(error, 'Bill scanning')));
        return null;
      }
      return data as ScannedBill;
    } catch (err) {
      showAlert('Could not read that bill', getErrorMessage(err));
      return null;
    } finally {
      setScanning(false);
    }
  }

  async function pickAndScan(): Promise<ScannedBill | null> {
    async function launch(fromCamera: boolean): Promise<ScannedBill | null> {
      const permission = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        showAlert(
          fromCamera ? 'Camera access needed' : 'Photo access needed',
          fromCamera ? 'Allow camera access to photograph the bill.' : 'Allow photo library access to pick the bill.'
        );
        return null;
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (result.canceled || !result.assets?.[0]) return null;
      return scanFromUri(result.assets[0].uri);
    }

    // Camera capture isn't a good fit on the web build - skip straight to
    // the file picker there instead of offering a choice that half-works.
    if (Platform.OS === 'web') return launch(false);

    return new Promise((resolve) => {
      showAlert('Scan a bill', 'Take a photo or pick one from your gallery.', [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
        { text: 'Choose from Gallery', onPress: () => launch(false).then(resolve) },
        { text: 'Take Photo', onPress: () => launch(true).then(resolve) },
      ]);
    });
  }

  return { scanning, pickAndScan };
}
