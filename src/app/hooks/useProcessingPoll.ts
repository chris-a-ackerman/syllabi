import { useEffect, useRef } from 'react';

const DEFAULT_INTERVAL_MS = 3000;

/**
 * Calls `onPoll` on an interval for as long as `active` is true.
 *
 * Used wherever the UI is waiting on syllabus processing to finish: the caller
 * passes `active` (e.g. "some course is still processing") and a refresh
 * function, and the interval is started and torn down for them.
 *
 * The callback is held in a ref so a caller passing an inline or unmemoised
 * function does not restart the interval on every render.
 */
export function useProcessingPoll(
  active: boolean,
  onPoll: () => void,
  intervalMs: number = DEFAULT_INTERVAL_MS,
) {
  const onPollRef = useRef(onPoll);

  useEffect(() => {
    onPollRef.current = onPoll;
  }, [onPoll]);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => onPollRef.current(), intervalMs);
    return () => clearInterval(interval);
  }, [active, intervalMs]);
}
