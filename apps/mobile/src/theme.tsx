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
    canvas: "#F6F8FC",
    surface: "#FFFFFF",
    ink: "#17283A",
    muted: "#607083",
    brand: "#3156E9",
    action: "#3156E9",
    onBrand: "#FFFFFF",
    tint: "#EBEFFF",
    border: "#DDE4EE",
    inputBorder: "#8492A6",
    navy: "#17283A",
    error: "#B02B46",
  },
  dark: {
    canvas: "#101C2A",
    surface: "#17283A",
    ink: "#F6F8FC",
    muted: "#B0BDCC",
    brand: "#9CAFFF",
    action: "#3156E9",
    onBrand: "#FFFFFF",
    tint: "#233958",
    border: "#304458",
    inputBorder: "#75879C",
    navy: "#17283A",
    error: "#FFB3C0",
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
