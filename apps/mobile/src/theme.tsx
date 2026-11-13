import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";

export type Appearance = "device" | "light" | "dark";
const palettes = {
  light: {
    canvas: "#F6F5EF",
    surface: "#FFFFFF",
    ink: "#17382B",
    muted: "#526357",
    brand: "#185C43",
    onBrand: "#FFFFFF",
    tint: "#E3EFE5",
    border: "#85978A",
    error: "#9C2828",
  },
  dark: {
    canvas: "#10241C",
    surface: "#193329",
    ink: "#F0F4EA",
    muted: "#BFCDC1",
    brand: "#A9D8B8",
    onBrand: "#10241C",
    tint: "#234735",
    border: "#81978A",
    error: "#FFB5AD",
  },
};
const ThemeContext = createContext({
  colors: palettes.light,
  dark: false,
  appearance: "device" as Appearance,
  setAppearance: (_value: Appearance) => {},
  preferenceError: "",
});
const preferenceKey = "nmt.device.appearance";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const device = useColorScheme();
  const [appearance, setPreference] = useState<Appearance>("device");
  const [preferenceError, setPreferenceError] = useState("");
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(preferenceKey)
      .then((value) => {
        if (
          active &&
          (value === "device" || value === "light" || value === "dark")
        )
          setPreference(value);
      })
      .catch(() => {
        if (active)
          setPreferenceError(
            "Appearance could not be restored. Choose it again below.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  const dark =
    appearance === "dark" || (appearance === "device" && device === "dark");
  const setAppearance = (value: Appearance) => {
    setPreference(value);
    setPreferenceError("");
    void AsyncStorage.setItem(preferenceKey, value).catch(() =>
      setPreferenceError(
        "Appearance changed for now. It could not be saved on this device.",
      ),
    );
  };
  return (
    <ThemeContext.Provider
      value={{
        colors: palettes[dark ? "dark" : "light"],
        dark,
        appearance,
        setAppearance,
        preferenceError,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
export const useTheme = () => useContext(ThemeContext);
