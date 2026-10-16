// lib/hooks/useVoiceCommand.ts
import { useState } from 'react';
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { File } from 'expo-file-system';
import { supabase } from '../supabase';
import { showAlert, getErrorMessage } from '../utils/alert';
import { edgeFunctionErrorText } from '../utils/edgeFunctionError';

export type VoiceAction = 'add_sale' | 'add_purchase' | 'add_expense' | 'payment_in' | 'payment_out';

export interface VoiceCommandItem {
  description: string;
  qty: number;
  rate: number;
}

export interface VoiceCommandResult {
  transcript: string;
  understood: boolean;
  action: VoiceAction | null;
  party_name: string | null;
  amount: number | null;
  date: string | null;
  note: string | null;
  items: VoiceCommandItem[];
}

/** Records a short Finance voice command and sends it to the voice-command
 * edge function (Gemini's audio understanding, same pattern as Scan Bill)
 * to figure out which of the five Finance actions was meant. Never saves
 * anything itself - the caller navigates to the right form pre-filled and
 * the reseller reviews/confirms it there, same as a scanned bill. */
export function useVoiceCommand() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);

  async function startRecording() {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      showAlert('Microphone access needed', 'Allow microphone access to add entries by voice.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
  }

  async function stopRecording(): Promise<VoiceCommandResult | null> {
    setRecording(false);
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return null;

    setProcessing(true);
    try {
      const file = new File(uri);
      const base64 = await file.base64();
      const { data, error } = await supabase.functions.invoke('voice-command', {
        body: { audio: base64, mimeType: 'audio/aac' },
      });
      if (error || !data || data.error) {
        showAlert('Could not understand that', data?.error ?? (await edgeFunctionErrorText(error, 'Voice entry')));
        return null;
      }
      const result = data as VoiceCommandResult;
      if (!result.understood || !result.action) {
        showAlert(
          "Didn't catch that",
          result.transcript
            ? `Heard: "${result.transcript}" - but couldn't tell what to add. Try naming the amount and who it's for.`
            : 'Please try again.'
        );
        return null;
      }
      return result;
    } catch (err) {
      showAlert('Could not process that recording', getErrorMessage(err));
      return null;
    } finally {
      setProcessing(false);
    }
  }

  return { recording, processing, startRecording, stopRecording };
}
