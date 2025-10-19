import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Keyboard,
  TouchableWithoutFeedback
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";
import { auth } from "./firebaseConfig";

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false); // Toggle between login and sign up

  const handleAuth = async () => {
    if (!email || !password) {
      Alert.alert("Error", "Please enter both email and password.");
      return;
    }

    setLoading(true);

    try {
      let userCredential;
      if (isSignUp) {
        // Sign up new user
        userCredential = await createUserWithEmailAndPassword(auth, email, password);
      } else {
        // Login existing user
        userCredential = await signInWithEmailAndPassword(auth, email, password);
      }

      // Store user info locally
      await AsyncStorage.setItem("userType", role);
      await AsyncStorage.setItem("userEmail", email);

      console.log(`${isSignUp ? "Signed up" : "Logged in"} as ${email} (${role})`);
      navigation.replace("MainApp");
    } catch (error) {
      console.error("Auth error:", error.message);
      Alert.alert("Error", error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={styles.container}>
        <Text style={styles.title}>
          {isSignUp ? "Create an Account" : "Welcome Back"}
        </Text>
  
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
  
        <TextInput
          style={styles.input}
          placeholder="Password"
          value={password}
          secureTextEntry
          onChangeText={setPassword}
        />
  
        {/* Role selection */}
        <View style={styles.roleContainer}>
          <TouchableOpacity
            onPress={() => setRole("user")}
            style={[styles.roleButton, role === "user" && styles.roleSelected]}
          >
            <Text style={role === "user" ? styles.roleTextSelected : styles.roleText}>
              User
            </Text>
          </TouchableOpacity>
  
          <TouchableOpacity
            onPress={() => setRole("vendor")}
            style={[styles.roleButton, role === "vendor" && styles.roleSelected]}
          >
            <Text style={role === "vendor" ? styles.roleTextSelected : styles.roleText}>
              Vendor
            </Text>
          </TouchableOpacity>
        </View>
  
        <TouchableOpacity
          style={styles.loginButton}
          onPress={handleAuth}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.loginButtonText}>
              {isSignUp ? "Sign Up" : "Login"}
            </Text>
          )}
        </TouchableOpacity>
  
        <TouchableOpacity
          onPress={() => setIsSignUp(!isSignUp)}
          style={styles.switchModeButton}
        >
          <Text style={styles.switchModeText}>
            {isSignUp
              ? "Already have an account? Login"
              : "Don't have an account? Sign Up"}
          </Text>
        </TouchableOpacity>
      </View>
    </TouchableWithoutFeedback>
  );  
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#fff" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 24, textAlign: "center" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    fontSize: 16,
  },
  roleContainer: { flexDirection: "row", justifyContent: "center", marginVertical: 10 },
  roleButton: {
    padding: 10,
    borderRadius: 8,
    marginHorizontal: 5,
    backgroundColor: "#E0E0E0",
  },
  roleSelected: {
    backgroundColor: "#007AFF",
  },
  roleText: {
    color: "black",
    fontWeight: "500",
  },
  roleTextSelected: {
    color: "white",
    fontWeight: "600",
  },
  loginButton: {
    backgroundColor: "#007AFF",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 20,
  },
  loginButtonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  switchModeButton: { marginTop: 20, alignItems: "center" },
  switchModeText: { color: "#007AFF", fontSize: 14, fontWeight: "500" },
});
