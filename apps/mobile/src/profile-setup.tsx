import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ComponentRef,
} from "react";
import { Alert, BackHandler, StyleSheet, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { useReducedMotion } from "react-native-reanimated";
import { profileInput, type ProfileInput } from "@nmt/contracts";
import { CloudOff, LifeBuoy } from "lucide-react-native";
import { Action, Field, Loading, Notice } from "./ui";
import {
  AuthBody,
  AuthPage,
  AuthTitle,
  ContinueArrow,
  TextAction,
  useAuthInputFocus,
} from "./auth-ui";
import { useTheme } from "./theme";

type Setup = {
  draft: ProfileInput;
  onChange: (change: Partial<ProfileInput>) => void;
  fields: Record<string, string>;
  saving: boolean;
  error: string;
  uncertain: boolean;
  onSave: () => void;
  onCheck: () => void;
  onExit: () => void;
};
const Context = createContext<Setup | null>(null);
function useSetup() {
  const value = useContext(Context);
  if (!value) throw Error("Profile setup is missing");
  return value;
}
type Routes = { Name: undefined; Username: undefined };
const Stack = createNativeStackNavigator<Routes>();
export function ProfileSetup(props: Setup) {
  const reduced = useReducedMotion();
  return (
    <Context.Provider value={props}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: reduced ? "fade" : "default",
          gestureEnabled: !props.saving,
        }}
      >
        <Stack.Screen name="Name" component={Name} />
        <Stack.Screen name="Username" component={Username} />
      </Stack.Navigator>
    </Context.Provider>
  );
}
function Name({ navigation }: NativeStackScreenProps<Routes, "Name">) {
  const setup = useSetup();
  const input = useAuthInputFocus();
  const lastNameInput = useRef<ComponentRef<typeof TextInput>>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const next = () => {
    const parsed = profileInput
      .pick({ firstName: true, lastName: true })
      .safeParse({
        firstName: setup.draft.firstName,
        lastName: setup.draft.lastName,
      });
    if (!parsed.success) {
      setFields(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0]),
            issue.message,
          ]),
        ),
      );
      return;
    }
    setFields({});
    navigation.navigate("Username");
  };
  return (
    <AuthPage
      onBack={setup.onExit}
      footer={
        <Action title="Continue" icon={<ContinueArrow />} onPress={next} />
      }
    >
      <AuthTitle>What’s your name?</AuthTitle>
      <AuthBody>Use the name your family knows you by.</AuthBody>
      <View style={styles.fields}>
        <Field
          inputRef={input}
          label="First name"
          testID="first-name-input"
          value={setup.draft.firstName}
          onChangeText={(firstName) => setup.onChange({ firstName })}
          error={fields.firstName ?? setup.fields.firstName}
          autoComplete="given-name"
          textContentType="givenName"
          autoCapitalize="words"
          maxLength={80}
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => lastNameInput.current?.focus()}
        />
        <Field
          inputRef={lastNameInput}
          label="Last name"
          testID="last-name-input"
          value={setup.draft.lastName}
          onChangeText={(lastName) => setup.onChange({ lastName })}
          error={fields.lastName ?? setup.fields.lastName}
          autoComplete="family-name"
          textContentType="familyName"
          autoCapitalize="words"
          maxLength={80}
          returnKeyType="next"
          onSubmitEditing={next}
        />
      </View>
    </AuthPage>
  );
}
function Username({ navigation }: NativeStackScreenProps<Routes, "Username">) {
  const setup = useSetup();
  const input = useAuthInputFocus();
  useFocusEffect(
    useCallback(() => {
      if (!setup.saving) return;
      const listener = BackHandler.addEventListener(
        "hardwareBackPress",
        () => true,
      );
      return () => listener.remove();
    }, [setup.saving]),
  );
  return (
    <AuthPage
      onBack={() => navigation.goBack()}
      backDisabled={setup.saving}
      footer={
        <>
          <Action
            title={
              setup.saving
                ? "Saving…"
                : setup.uncertain
                  ? "Retry save"
                  : "Start planning"
            }
            busy={setup.saving}
            onPress={setup.onSave}
          />
          {setup.uncertain && (
            <TextAction
              title="Check saved profile"
              disabled={setup.saving}
              onPress={setup.onCheck}
            />
          )}
        </>
      }
    >
      <AuthTitle>Choose your username</AuthTitle>
      <AuthBody>This is how your family can find and invite you.</AuthBody>
      <View style={styles.fields}>
        <Field
          inputRef={input}
          label="Username"
          testID="username-input"
          placeholder="your_name"
          value={setup.draft.username}
          onChangeText={(username) => setup.onChange({ username })}
          error={setup.fields.username}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={30}
          editable={!setup.saving}
          onSubmitEditing={setup.onSave}
          returnKeyType="go"
        />
        <AuthBody>
          4–30 letters, numbers, or underscores. Your username can’t be changed
          later.
        </AuthBody>
      </View>
      {setup.error && <Notice error>{setup.error}</Notice>}
    </AuthPage>
  );
}
export function ProfileRecovery({
  loading,
  failure,
  message,
  onRetry,
  onSignOut,
  onCheckRemoval,
  cached,
}: {
  loading: boolean;
  failure: "server" | "offline" | "session" | null;
  message: string;
  onRetry: () => void;
  onSignOut: () => void;
  onCheckRemoval: () => void;
  cached?: { trips: () => void; guides: () => void };
}) {
  const { colors } = useTheme();
  return (
    <AuthPage
      help={
        failure && (
          <TextAction
            title="Help"
            onPress={() =>
              Alert.alert(
                "Having trouble?",
                "You can sign out safely, or check the status of a previous account-removal request.",
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Check account removal", onPress: onCheckRemoval },
                ],
              )
            }
          />
        )
      }
      footer={
        <>
          {failure && (
            <Action title="Try again" busy={loading} onPress={onRetry} />
          )}
          {cached && (
            <>
              <TextAction title="Open cached trips" onPress={cached.trips} />
              <TextAction title="Open saved guides" onPress={cached.guides} />
            </>
          )}
          <TextAction title="Sign out" muted onPress={onSignOut} />
        </>
      }
    >
      <View style={styles.recovery}>
        {failure ? (
          <>
            <View style={[styles.symbol, { backgroundColor: colors.tint }]}>
              {failure === "server" ? (
                <LifeBuoy color={colors.brand} size={32} accessible={false} />
              ) : (
                <CloudOff color={colors.brand} size={32} accessible={false} />
              )}
            </View>
            <AuthTitle centered>
              {failure === "session"
                ? "Let’s reconnect"
                : failure === "server"
                  ? "We couldn’t open your account"
                  : "You’re offline"}
            </AuthTitle>
            <AuthBody centered>
              {failure === "server"
                ? "You’re signed in. Our service is having trouble loading your profile. Please try again shortly."
                : failure === "session"
                  ? "Your sign-in needs to be refreshed. Try again, or sign out and sign in again."
                  : "Check your internet connection, then try again."}
            </AuthBody>
            {message && <Notice error>{message}</Notice>}
            {cached && (
              <AuthBody centered>
                Your saved trips and guides are available to read on this
                device.
              </AuthBody>
            )}
          </>
        ) : (
          <>
            <Loading kind="profile" message="Opening your account" />
          </>
        )}
      </View>
    </AuthPage>
  );
}
const styles = StyleSheet.create({
  fields: { paddingTop: 14, gap: 22 },
  recovery: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 18,
    paddingVertical: 32,
  },
  symbol: {
    width: 76,
    height: 76,
    borderRadius: 24,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
  },
});
