import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { api, useSession } from '../../context/SessionContext';
import type { Session } from '../../api/types';
import { Button, colors, Field, Icon, Notice } from '../../components/ui';

export default function AuthScreen() {
  const { establish } = useSession();
  const [signup, setSignup] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const wide = useWindowDimensions().width >= 850;
  async function submit() {
    if (busy) return;
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      return setError('Enter a valid email address.');
    if (password.length < 8 || password.length > 128)
      return setError('Use a password between 8 and 128 characters.');
    if (signup && !name.trim()) return setError('Enter your display name.');
    setBusy(true);
    try {
      const session = await api.request<Session>(
        `/api/auth/${signup ? 'sign-up' : 'sign-in'}`,
        {
          method: 'POST',
          body: JSON.stringify({
            email: email.trim(),
            password,
            ...(signup ? { name: name.trim() } : {}),
          }),
        },
        false,
      );
      await establish(session);
      router.replace('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {wide && (
        <LinearGradient colors={['#2995ED', '#2378D1']} style={s.story}>
          <View style={s.brand}>
            <Icon name="paper-plane" color="white" size={27} />
            <Text style={s.brandName}>reducto</Text>
          </View>
          <View style={s.storyBody}>
            <View style={s.orbit}>
              <View style={s.plane}>
                <Icon name="paper-plane" size={78} color="white" />
              </View>
            </View>
            <Text style={s.headline}>A little closer.{'\n'}Every conversation.</Text>
            <Text style={s.storyText}>
              Your people, your groups, your everyday moments. All together in one simple place.
            </Text>
            <View style={s.feature}>
              <Icon name="flash-outline" color="#D7ECFF" size={20} />
              <Text style={s.featureText}>Instant messages. Real connections.</Text>
            </View>
            <View style={s.feature}>
              <Icon name="phone-portrait-outline" color="#D7ECFF" size={20} />
              <Text style={s.featureText}>At home on every screen.</Text>
            </View>
          </View>
          <Text style={s.storyFoot}>MADE FOR THE WAY YOU CONNECT</Text>
        </LinearGradient>
      )}
      <ScrollView
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={s.formWrap}
      >
        <View style={s.form}>
          <View style={s.smallLogo}>
            <Icon name="paper-plane" size={36} color="white" />
          </View>
          <Text style={s.heading}>{signup ? 'Join the conversation' : 'Welcome to Reducto'}</Text>
          <Text style={s.description}>
            {signup
              ? 'Create an account and bring your people closer.'
              : 'Sign in to pick up where you left off.'}
          </Text>
          <View style={s.tabs}>
            {['Sign in', 'Create account'].map((label, index) => (
              <Pressable
                key={label}
                accessibilityRole="tab"
                accessibilityState={{ selected: signup === !!index }}
                onPress={() => {
                  setSignup(!!index);
                  setError('');
                }}
                style={[s.tab, signup === !!index && s.activeTab]}
              >
                <Text
                  style={{
                    fontWeight: '600',
                    color: signup === !!index ? colors.blue : colors.muted,
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={{ gap: 20 }}>
            {signup && (
              <Field
                label="Display name"
                placeholder="How should we call you?"
                value={name}
                onChangeText={setName}
                maxLength={100}
                autoComplete="name"
              />
            )}
            <Field
              label="Email address"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
            <View>
              <Field
                label="Password"
                placeholder={signup ? 'At least 8 characters' : 'Enter your password'}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!visible}
                autoCapitalize="none"
                autoComplete={signup ? 'new-password' : 'current-password'}
                onSubmitEditing={() => void submit()}
                style={{ paddingRight: 52 }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={visible ? 'Hide password' : 'Show password'}
                onPress={() => setVisible(!visible)}
                style={{ position: 'absolute', right: 13, bottom: 14 }}
              >
                <Icon name={visible ? 'eye-off-outline' : 'eye-outline'} />
              </Pressable>
            </View>
            <Notice text={error} />
            <Button
              title={signup ? 'Create account' : 'Sign in'}
              busy={busy}
              onPress={() => void submit()}
            />
          </View>
          <View style={s.caption}>
            <Icon name="chatbubbles-outline" size={17} color="#99A8B5" />
            <Text style={s.captionText}>Good conversations start here.</Text>
          </View>
        </View>
        <Text style={s.footer}>REDUCTO · A SPACE FOR YOUR PEOPLE</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'white', flexDirection: 'row' },
  story: { width: '45%', padding: 48, justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brandName: { fontSize: 27, color: 'white', fontWeight: '700', letterSpacing: -1 },
  storyBody: { maxWidth: 420, alignSelf: 'center', width: '100%', gap: 16, paddingVertical: 30 },
  orbit: { height: 180, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  plane: {
    width: 156,
    height: 156,
    borderRadius: 78,
    backgroundColor: '#FFFFFF18',
    borderWidth: 1,
    borderColor: '#FFFFFF30',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
  },
  headline: {
    color: 'white',
    fontSize: 42,
    fontWeight: '700',
    lineHeight: 50,
    letterSpacing: -1.3,
  },
  storyText: { color: '#DBEEFF', fontSize: 17, lineHeight: 28, marginBottom: 16 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureText: { color: '#EDF6FF', fontSize: 14 },
  storyFoot: { color: '#C3E2FF', letterSpacing: 2, fontSize: 10 },
  formWrap: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    minHeight: '100%',
  },
  form: { maxWidth: 380, width: '100%', paddingVertical: 48 },
  smallLogo: {
    width: 76,
    height: 76,
    backgroundColor: colors.blue,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 30,
  },
  heading: {
    color: colors.dark,
    fontWeight: '700',
    fontSize: 29,
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  description: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 10,
  },
  tabs: {
    flexDirection: 'row',
    padding: 4,
    backgroundColor: colors.pale,
    borderRadius: 12,
    marginTop: 30,
    marginBottom: 28,
  },
  tab: { flex: 1, paddingVertical: 11, alignItems: 'center', borderRadius: 9 },
  activeTab: { backgroundColor: 'white', boxShadow: '0 1px 5px #17212B10' },
  caption: {
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  captionText: { fontSize: 12, color: '#99A8B5' },
  footer: { fontSize: 10, color: '#A0ADBA', letterSpacing: 1.5, paddingTop: 20 },
});
