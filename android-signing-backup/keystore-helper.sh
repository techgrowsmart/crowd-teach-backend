#!/bin/bash

echo "🔍 Keystore Information Extractor & Creator"
echo "============================================"
echo ""

echo "📋 OPTIONS TO FIND YOUR KEYSTORE INFO:"
echo ""

echo "Option 1: Check existing debug keystore (for reference):"
if [ -f "android/app/debug.keystore" ]; then
    echo "🔍 Debug keystore info:"
    keytool -list -v -keystore android/app/debug.keystore -storepass android -keypass android 2>/dev/null | grep -E "Alias name|SHA1"
    echo ""
fi

echo "Option 2: Try common passwords with your keystore file:"
echo "Common passwords to try:"
echo "  - android"
echo "  - password" 
echo "  - your name/company name"
echo "  - 123456"
echo "  - (empty password)"
echo ""

echo "Option 3: Create NEW keystore (if you can't find original):"
echo "⚠️  WARNING: This will create a NEW keystore with different SHA1!"
echo "   You'll need to update Google Play Console with the new key."
echo ""

read -p "Do you want to create a NEW keystore? (y/n): " create_new

if [[ $create_new == "y" || $create_new == "Y" ]]; then
    echo ""
    echo "🔑 Creating new production keystore..."
    
    # Get user input
    read -p "Enter keystore password (min 6 chars): " keystore_pass
    read -p "Enter key password (min 6 chars): " key_pass
    read -p "Enter key alias (e.g., upload): " key_alias
    
    echo ""
    echo "📝 Generating keystore with:"
    echo "  Keystore: android/app/release.keystore"
    echo "  Alias: $key_alias"
    echo "  Passwords: [hidden]"
    echo ""
    
    # Generate keystore
    keytool -genkey -v -keystore android/app/release.keystore -alias "$key_alias" -keyalg RSA -keysize 2048 -validity 10000 \
        -storepass "$keystore_pass" -keypass "$key_pass" \
        -dname "CN=GROWSMART, OU=Development, O=GROWSMART, L=City, ST=State, C=US"
    
    if [ $? -eq 0 ]; then
        echo ""
        echo "✅ Keystore created successfully!"
        echo ""
        echo "🔍 New keystore SHA1:"
        keytool -list -v -keystore android/app/release.keystore -storepass "$keystore_pass" -keypass "$key_pass" | grep SHA1
        echo ""
        echo "📋 Update your gradle.properties with:"
        echo "MYAPP_RELEASE_STORE_FILE=release.keystore"
        echo "MYAPP_RELEASE_KEY_ALIAS=$key_alias"
        echo "MYAPP_RELEASE_STORE_PASSWORD=$keystore_pass"
        echo "MYAPP_RELEASE_KEY_PASSWORD=$key_pass"
        echo ""
        echo "⚠️  IMPORTANT: You'll need to update Google Play Console with this new SHA1!"
    else
        echo "❌ Failed to create keystore"
    fi
else
    echo ""
    echo "🔍 To extract info from existing keystore:"
    echo "1. Place your keystore at android/app/release.keystore"
    echo "2. Run: keytool -list -v -keystore android/app/release.keystore"
    echo "3. It will prompt for password - try common ones"
    echo ""
    echo "📧 If you can't access it, contact Google Play Console support"
fi
