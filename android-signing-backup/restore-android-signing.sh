#!/bin/bash

echo "🔧 Android Signing Keys Restoration Tool"
echo "======================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header() {
    echo -e "${BLUE}=== $1 ===${NC}"
}

# Function to restore android folder structure
restore_android_structure() {
    print_header "Restoring Android Folder Structure"
    
    # Create android directory structure
    mkdir -p android/app
    mkdir -p android/gradle
    mkdir -p android/app/src/main
    
    print_status "Created android directory structure"
}

# Function to restore signing configuration
restore_signing_config() {
    print_header "Restoring Signing Configuration"
    
    # Restore gradle.properties
    if [[ -f "gradle.properties" ]]; then
        cp gradle.properties android/
        print_status "Restored gradle.properties"
    else
        print_warning "gradle.properties not found in backup"
    fi
    
    # Restore app build.gradle
    if [[ -f "build.gradle" ]]; then
        cp build.gradle android/app/
        print_status "Restored app build.gradle"
    else
        print_warning "app build.gradle not found in backup"
    fi
    
    # Restore debug keystore
    if [[ -f "debug.keystore" ]]; then
        cp debug.keystore android/app/
        print_status "Restored debug.keystore"
    else
        print_warning "debug.keystore not found in backup"
    fi
}

# Function to restore production keystores
restore_production_keystores() {
    print_header "Restoring Production Keystores"
    
    local keystore_files=(
        "temp.jks"
        "gogrowsmart_production.jks"
        "gogrowsmart_with_cert.jks"
        "gogrowsmart_exact.jks"
        "gogrowsmart_signing.jks"
        "upload-keystore.jks"
    )
    
    for keystore in "${keystore_files[@]}"; do
        if [[ -f "$keystore" ]]; then
            cp "$keystore" ./
            print_status "Restored $keystore"
        fi
    done
}

# Function to setup gradle.properties for production signing
setup_production_signing() {
    print_header "Setting up Production Signing Configuration"
    
    # Check if we have keystore info
    if [[ -f "keystore-info.txt" ]]; then
        print_status "Found keystore information"
        echo ""
        echo "Available keystore information:"
        cat keystore-info.txt
        echo ""
        
        read -p "Do you want to configure production signing in gradle.properties? (y/n): " configure_signing
        
        if [[ $configure_signing == "y" || $configure_signing == "Y" ]]; then
            echo ""
            echo "Please enter the following information for your production keystore:"
            read -p "Keystore filename (e.g., gogrowsmart_production.jks): " keystore_file
            read -p "Key alias: " key_alias
            read -p "Store password: " store_password
            read -p "Key password: " key_password
            
            # Update gradle.properties
            if [[ -f "android/gradle.properties" ]]; then
                # Remove existing signing config if any
                sed -i.bak '/MYAPP_RELEASE_/d' android/gradle.properties
                
                # Add new signing config
                echo "" >> android/gradle.properties
                echo "# Production signing configuration" >> android/gradle.properties
                echo "MYAPP_RELEASE_STORE_FILE=$keystore_file" >> android/gradle.properties
                echo "MYAPP_RELEASE_KEY_ALIAS=$key_alias" >> android/gradle.properties
                echo "MYAPP_RELEASE_STORE_PASSWORD=$store_password" >> android/gradle.properties
                echo "MYAPP_RELEASE_KEY_PASSWORD=$key_password" >> android/gradle.properties
                print_status "Updated gradle.properties with production signing configuration"
            fi
        fi
    else
        print_warning "No keystore information found. You'll need to configure signing manually."
    fi
}

# Main restoration process
main() {
    print_status "Starting Android signing keys restoration..."
    echo ""
    
    restore_android_structure
    restore_signing_config
    restore_production_keystores
    setup_production_signing
    
    print_header "Restoration Complete"
    print_status "Android signing keys have been restored!"
    echo ""
    echo "Next steps:"
    echo "1. Review the restored configuration"
    echo "2. Test build with: ./gradlew assembleDebug"
    echo "3. Test release build with: ./gradlew assembleRelease"
    echo "4. Verify SHA1 fingerprints match Google Play Console"
    echo ""
    echo "Keystore information is available in: keystore-info.txt"
}

# Run main function
main
