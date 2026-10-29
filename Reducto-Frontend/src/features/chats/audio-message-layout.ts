/** Keep pending and completed audio bubbles identical in size and text metrics. */
export const audioMessageLayout = {
  row: {
    width: 236,
    maxWidth: '100%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  controls: { flex: 1, minWidth: 0 },
  heading: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, fontSize: 14, lineHeight: 18, fontWeight: '500' },
  artist: { height: 20, lineHeight: 20, fontSize: 12 },
  time: { fontSize: 12, lineHeight: 14 },
} as const;
