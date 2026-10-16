// lib/components/AppAlertHost.tsx
import { useEffect, useRef } from 'react';
import { View, Text, Pressable, Platform, Modal, useWindowDimensions, PanResponder, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAlertStore, type AlertButton } from '../utils/alert';

const AUTO_DISMISS_MS = 7500;
const MOBILE_BREAKPOINT = 768;
const CORNER_WIDTH = 340;
const SWIPE_DISMISS_DISTANCE = 60;
const SWIPE_DISMISS_VELOCITY = 0.5;

// Mount once near the root (see app/_layout.tsx). Renders whatever
// showAlert() queues up as a toast in the corner (a bottom band on
// mobile), instead of a full-screen OS dialog or browser alert/confirm.
// It never blocks the rest of the screen, clears itself on its own after
// a timeout, and can be swiped away early.
//
// A message that asks a question (more than one button: Cancel / Delete, Cancel / Change ...) is not a
// toast: it is a dialog in the middle of the screen, above whatever popup is open, that waits for an
// answer. A toast in the corner sat behind an open popup's dimmed overlay, where it could not be pressed.
export function AppAlertHost() {
  const queue = useAlertStore((state) => state.queue);
  const dismissCurrent = useAlertStore((state) => state.dismissCurrent);
  const current = queue[0];
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isMobile = Platform.OS !== 'web' || width < MOBILE_BREAKPOINT;

  // PanResponder is created once via useRef, so its handlers close over
  // whatever `current` was at mount time. This ref is reassigned every
  // render instead, so the handlers below always see the alert actually
  // on screen (same trick as FloatingAssistantChat's drag handling).
  const currentRef = useRef(current);
  currentRef.current = current;

  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  useEffect(() => {
    pan.setValue({ x: 0, y: 0 });
  }, [current?.id, pan]);

  useEffect(() => {
    // A question waits for its answer; only a lone acknowledgement clears itself.
    if (!current || current.buttons.length > 1) return;
    const timer = setTimeout(() => {
      // Treat an unattended timeout like a cancel, not silence, so callers
      // awaiting a button choice (e.g. login.tsx's offerBiometricSignIn)
      // still resolve instead of hanging forever.
      const cancelButton = current.buttons.find((button) => button.style === 'cancel');
      dismissCurrent();
      cancelButton?.onPress?.();
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [current, dismissCurrent]);

  function dismissViaGesture(dx: number, dy: number) {
    const alert = currentRef.current;
    Animated.timing(pan, {
      toValue: { x: dx * 3, y: dy * 3 },
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      const cancelButton = alert?.buttons.find((button) => button.style === 'cancel');
      dismissCurrent();
      cancelButton?.onPress?.();
    });
  }

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) => Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6,
      onPanResponderMove: (_evt, gesture) => pan.setValue({ x: gesture.dx, y: gesture.dy }),
      onPanResponderRelease: (_evt, gesture) => {
        const distance = Math.hypot(gesture.dx, gesture.dy);
        const speed = Math.hypot(gesture.vx, gesture.vy);
        if (distance > SWIPE_DISMISS_DISTANCE || speed > SWIPE_DISMISS_VELOCITY) {
          dismissViaGesture(gesture.dx, gesture.dy);
        } else {
          Animated.spring(pan, { toValue: { x: 0, y: 0 }, friction: 6, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  if (!current) return null;

  const isMultiButton = current.buttons.length > 1;

  function handlePress(button: AlertButton) {
    dismissCurrent();
    button.onPress?.();
  }

  if (isMultiButton) {
    // Esc, the back button and a click outside are a Cancel.
    const cancel = () => {
      const cancelButton = current.buttons.find((button) => button.style === 'cancel');
      dismissCurrent();
      cancelButton?.onPress?.();
    };
    return (
      <Modal visible transparent animationType="fade" onRequestClose={cancel}>
        <Pressable className="flex-1 items-center justify-center bg-black/40 px-5" onPress={cancel}>
          <Pressable
            onPress={() => {}}
            className="w-full rounded-2xl bg-white p-5"
            style={{ maxWidth: 420, boxShadow: '0 20px 48px rgba(16,24,40,0.28)' }}
          >
            <Text className="text-base font-bold text-gray-900">{current.title}</Text>
            {current.message ? <Text className="mt-1.5 text-sm leading-5 text-gray-600">{current.message}</Text> : null}
            <View className="mt-5 flex-row flex-wrap justify-end" style={{ gap: 8 }}>
              {current.buttons.map((button, index) => {
                const isCancel = button.style === 'cancel';
                const isDestructive = button.style === 'destructive';
                return (
                  <Pressable
                    key={index}
                    onPress={() => handlePress(button)}
                    className={`min-w-[88px] items-center rounded-xl px-4 py-2.5 ${
                      isCancel ? 'border border-gray-300 bg-white' : isDestructive ? 'bg-red-600' : 'bg-orange-600'
                    }`}
                  >
                    <Text className={`text-sm font-bold ${isCancel ? 'text-gray-600' : 'text-white'}`}>{button.text}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }}>
      <Animated.View
        pointerEvents="auto"
        {...panResponder.panHandlers}
        style={[
          isMobile
            ? {
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                minHeight: height * 0.2,
                paddingBottom: insets.bottom,
              }
            : {
                position: 'absolute',
                right: 16 + insets.right,
                bottom: 16 + insets.bottom,
                width: CORNER_WIDTH,
                maxWidth: '90%',
              },
          { transform: pan.getTranslateTransform() },
        ]}
      >
        {/* NativeWind's className styling doesn't reliably apply straight on
            Animated.View (this is the only place in the app that tried it) -
            it silently dropped the background/border/shadow, leaving a fully
            see-through band that whatever's underneath showed straight
            through. A plain View underneath carries the visible "card"
            styling instead; Animated.View above only handles position/drag. */}
        <View
          className={
            isMobile
              ? 'flex-1 justify-center rounded-t-2xl border border-gray-100 bg-white px-5 py-4 shadow-lg'
              : 'rounded-2xl border border-gray-100 bg-white p-4 shadow-lg'
          }
        >
          <Text className="text-base font-bold text-gray-900" numberOfLines={2}>
            {current.title}
          </Text>
          {current.message ? (
            <Text className="mt-1 text-sm text-gray-600" numberOfLines={isMobile ? 3 : 4}>
              {current.message}
            </Text>
          ) : null}

          {/* A lone acknowledgement (OK) sits centred under the message, as
              a system dialog would; a choice keeps its buttons on the right. */}
          <View className={isMultiButton ? 'mt-3 flex-row justify-end gap-2' : 'mt-3.5 items-center'}>
            {current.buttons.map((button, index) => (
              <Pressable
                key={index}
                onPress={() => handlePress(button)}
                className={
                  isMultiButton
                    ? 'rounded-lg px-3 py-1.5'
                    : 'h-11 min-w-[128px] items-center justify-center rounded-xl bg-orange-600 px-6'
                }
              >
                <Text
                  className={
                    isMultiButton
                      ? button.style === 'destructive'
                        ? 'text-sm font-semibold text-red-600'
                        : button.style === 'cancel'
                          ? 'text-sm font-semibold text-gray-500'
                          : 'text-sm font-semibold text-orange-600'
                      : 'text-[15px] font-bold text-white'
                  }
                >
                  {button.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Animated.View>
    </View>
  );
}
