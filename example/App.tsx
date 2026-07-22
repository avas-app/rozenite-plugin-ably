import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useAblyDevTools } from 'rozenite-plugin-ably'
// Imported by path, not from the package: the scenario driver is example
// infrastructure and deliberately not part of the plugin's public API.
import {
  SCENARIO_ACTIONS,
  SCENARIO_LABELS,
  connectScenario,
  createFakeAblyClient,
  runAction,
  startTraffic,
  type ScenarioAction,
} from '../src/dev/scenario'

/**
 * Example app for `rozenite-plugin-ably`.
 *
 * The Ably client here is a fake — it produces realistic traffic with no
 * network, no API key, and no login. Everything else is real: the client is
 * instrumented through the actual `useAblyDevTools` hook and the actual
 * Rozenite bridge, so what you see in the panel is what a production app
 * produces.
 *
 * Run it, press `j` to open React Native DevTools, and pick the **Ably** tab.
 */
export default function App() {
  const isDark = useColorScheme() === 'dark'
  const client = useMemo(() => createFakeAblyClient(), [])
  const [log, setLog] = useState<string[]>([])
  const [trafficOn, setTrafficOn] = useState(true)
  const stopTraffic = useRef<(() => void) | null>(null)

  // This is the only line an app needs. Everything below is scenario driving.
  useAblyDevTools(client, {
    labels: {
      getLabels: () => SCENARIO_LABELS,
    },
  })

  useEffect(() => {
    connectScenario(client)
  }, [client])

  useEffect(() => {
    if (!trafficOn) {
      stopTraffic.current?.()
      stopTraffic.current = null
      return
    }
    stopTraffic.current = startTraffic(client)
    return () => {
      stopTraffic.current?.()
      stopTraffic.current = null
    }
  }, [client, trafficOn])

  const fire = (action: ScenarioAction, label: string) => {
    runAction(client, action)
    setLog((prev) => [`${timestamp()} ${label}`, ...prev].slice(0, 8))
  }

  const theme = isDark ? dark : light

  return (
    <SafeAreaView style={[styles.root, theme.root]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, theme.text]}>Ably DevTools Example</Text>
        <Text style={[styles.subtitle, theme.dim]}>
          Press <Text style={styles.kbd}>j</Text> to open React Native DevTools,
          then choose the <Text style={styles.strong}>Ably</Text> tab.
        </Text>

        <View style={[styles.card, theme.card]}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={[styles.cardTitle, theme.text]}>
                Background traffic
              </Text>
              <Text style={[styles.hint, theme.dim]}>
                Sensor readings every 0.9s, chat every 7s
              </Text>
            </View>
            <Pressable
              onPress={() => setTrafficOn((on) => !on)}
              style={[styles.toggle, trafficOn ? styles.toggleOn : theme.toggleOff]}
            >
              <Text style={trafficOn ? styles.toggleOnText : theme.dim}>
                {trafficOn ? 'ON' : 'OFF'}
              </Text>
            </Pressable>
          </View>
        </View>

        <Text style={[styles.sectionTitle, theme.dim]}>Trigger</Text>
        <View style={styles.grid}>
          {SCENARIO_ACTIONS.map((action) => (
            <Pressable
              key={action.id}
              onPress={() => fire(action.id, action.label)}
              style={({ pressed }) => [
                styles.button,
                theme.button,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={[styles.buttonLabel, theme.text]}>{action.label}</Text>
              <Text style={[styles.buttonHint, theme.dim]}>{action.hint}</Text>
            </Pressable>
          ))}
        </View>

        {log.length > 0 ? (
          <>
            <Text style={[styles.sectionTitle, theme.dim]}>Recent</Text>
            <View style={[styles.card, theme.card]}>
              {log.map((line, index) => (
                <Text
                  key={`${line}-${index}`}
                  style={[styles.logLine, theme.dim]}
                  numberOfLines={1}
                >
                  {line}
                </Text>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}

function timestamp() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 20, gap: 12 },
  flex: { flex: 1 },
  title: { fontSize: 24, fontWeight: '700' },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: 4 },
  strong: { fontWeight: '700' },
  kbd: {
    fontFamily: 'Courier',
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 8,
  },
  card: { borderRadius: 12, padding: 14, borderWidth: 1, gap: 6 },
  cardTitle: { fontSize: 15, fontWeight: '600' },
  hint: { fontSize: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggle: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  toggleOn: { backgroundColor: '#8232ff' },
  toggleOnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: '31%',
    flexGrow: 1,
    gap: 2,
  },
  buttonPressed: { opacity: 0.6 },
  buttonLabel: { fontSize: 13, fontWeight: '600' },
  buttonHint: { fontSize: 10 },
  logLine: { fontSize: 11, fontFamily: 'Courier' },
})

const light = StyleSheet.create({
  root: { backgroundColor: '#f6f7f8' },
  text: { color: '#1b1d1f' },
  dim: { color: '#5c646a' },
  card: { backgroundColor: '#fff', borderColor: '#e0e4e7' },
  button: { backgroundColor: '#fff', borderColor: '#e0e4e7' },
  toggleOff: { backgroundColor: '#eceef0' },
})

const dark = StyleSheet.create({
  root: { backgroundColor: '#141617' },
  text: { color: '#e6e8ea' },
  dim: { color: '#9aa2a8' },
  card: { backgroundColor: '#1e2123', borderColor: '#2f3437' },
  button: { backgroundColor: '#1e2123', borderColor: '#2f3437' },
  toggleOff: { backgroundColor: '#2b2f31' },
})
