import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Linking,
  Image,
} from 'react-native';

export default function FoodTruckInfoScreen({ visible, truck, onClose, onConfirm, onReportIssue, onToggleFavorite, isFavorited, userType }) {
  if (!truck) return null;

  const handleNavigate = () => {
    const { latitude, longitude } = truck.location;
    const url = `https://maps.apple.com/?daddr=${latitude},${longitude}`;
    Linking.openURL(url);
  };

  const getCrowdLevelColor = (level) => {
    switch (level) {
      case 'Light': return '#4CAF50';
      case 'Moderate': return '#FF9800';
      case 'Busy': return '#F44336';
      default: return '#999';
    }
  };

  const getStatusBadge = () => {
    if (truck.status === 'verified') {
      return { text: 'Verified', color: '#4CAF50', icon: '✓' };
    }
    return { text: 'Pending', color: '#999', icon: '⏳' };
  };

  const timeAgo = (timestamp) => {
    const now = new Date();
    const time = new Date(timestamp);
    const minutes = Math.floor((now - time) / 60000);
    
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    return `${Math.floor(hours / 24)} days ago`;
  };

  const statusBadge = getStatusBadge();

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <TouchableOpacity 
        style={styles.overlay} 
        activeOpacity={1} 
        onPress={onClose}
      >
        <TouchableOpacity 
          activeOpacity={1} 
          style={styles.modalContainer}
          onPress={(e) => e.stopPropagation()}
        >
          {/* header image placeholder for now */}
          <View style={styles.headerImage}>
            <Text style={styles.headerEmoji}>🚚</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.content}>
            {/* title section */}
            <View style={styles.titleSection}>
              <View style={styles.titleRow}>
                <Text style={styles.truckName}>{truck.foodTruckName}</Text>
                <View style={[styles.statusBadge, { backgroundColor: statusBadge.color }]}>
                  <Text style={styles.statusText}>{statusBadge.icon} {statusBadge.text}</Text>
                </View>
              </View>
              
              <View style={styles.cuisineBadge}>
                <Text style={styles.cuisineText}>{truck.cuisineType}</Text>
              </View>
            </View>

            {/* location */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Location</Text>
              <Text style={styles.address}>{truck.location.address}</Text>
            </View>

            {/* quick info card */}
            <View style={styles.quickInfo}>
              <View style={styles.infoCard}>
                <Text style={styles.infoIcon}>🕐</Text>
                <Text style={styles.infoLabel}>Updated</Text>
                <Text style={styles.infoValue}>{timeAgo(truck.timestamp)}</Text>
              </View>

              <View style={styles.infoCard}>
                <Text style={styles.infoIcon}>📍</Text>
                <Text style={styles.infoLabel}>Distance</Text>
                <Text style={styles.infoValue}>0.7 mi</Text>
              </View>

              <View style={[styles.infoCard, { backgroundColor: getCrowdLevelColor(truck.crowdLevel) }]}>
                <Text style={styles.infoIcon}>👥</Text>
                <Text style={[styles.infoLabel, { color: 'white' }]}>Crowd</Text>
                <Text style={[styles.infoValue, { color: 'white', fontWeight: '700' }]}>
                  {truck.crowdLevel}
                </Text>
              </View>
            </View>

            {/* inventory level (only if provided) */}
            {truck.inventoryLevel && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Food Availability</Text>
                <View style={styles.inventoryBadge}>
                  <Text style={styles.inventoryText}>
                    {truck.inventoryLevel === 'Plenty' ? '✅' : 
                     truck.inventoryLevel === 'Running Low' ? '⚠️' : '🔴'} {truck.inventoryLevel}
                  </Text>
                </View>
              </View>
            )}

            {/* Additional Notes */}
            {truck.additionalNotes && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Notes</Text>
                <Text style={styles.notes}>{truck.additionalNotes}</Text>
              </View>
            )}

            {/* confirmation info */}
            <View style={[
              styles.confirmationInfo, 
              { backgroundColor: truck.status === 'verified' ? '#e7f8ef' : '#fff3cd' }
            ]}>
              <Text style={styles.confirmationIcon}>
                {truck.status === 'verified' ? '✓' : '⏳'}
              </Text>
              <Text style={styles.confirmationText}>
                {truck.status === 'verified' ? (
                  <>
                    {truck.confirmations && truck.confirmations.length > 0 
                      ? `Confirmed by ${truck.confirmations.length} user${truck.confirmations.length > 1 ? 's' : ''} today`
                      : 'Verified'
                    }
                    {truck.lastConfirmedAt && 
                      ` • Last confirmed ${timeAgo(truck.lastConfirmedAt)}`
                    }
                  </>
                ) : (
                  <>
                    Pending verification • {truck.confirmationCount || 1} of 5 confirmations
                    {truck.lastConfirmedAt && 
                      ` • Last confirmed ${timeAgo(truck.lastConfirmedAt)}`
                    }
                  </>
                )}
              </Text>
            </View>

            {/* action buttons */}
            <View style={styles.actions}>
                {userType === 'user' && (
                <TouchableOpacity 
                 style={[styles.pinButton, isFavorited && styles.pinnedButton]}
                 onPress={() => onToggleFavorite && onToggleFavorite(truck)}
                >
                <Text style={styles.pinButtonText}>
                    {isFavorited ? '📌 Pinned' : '📍 Pin Truck'}
                </Text>
                </TouchableOpacity>
                )}
                {/* confirm button logic */}
              <TouchableOpacity 
                  style={styles.confirmButton}
                  onPress={() => {
                    onConfirm && onConfirm(truck);
                    onClose();
                  }}
                >
                  <Text style={styles.confirmButtonText}>
                    {truck.status === 'verified' ? '✓ Still Here!' : '✓ Confirm Location'}
                  </Text>
                </TouchableOpacity>
                {/* */}
              <TouchableOpacity 
                style={styles.reportButton}
                onPress={() => {
                  onReportIssue && onReportIssue(truck);
                  onClose();
                }}
              >
                <Text style={styles.reportButtonText}>⚠ Report Issue</Text>
              </TouchableOpacity>
            </View>

            {/* navigation button */}
            <TouchableOpacity style={styles.navigateButton} onPress={handleNavigate}>
              <Text style={styles.navigateButtonText}>🧭 Navigate to {truck.foodTruckName}</Text>
            </TouchableOpacity>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: 'white',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
  },
  headerImage: {
    height: 200,
    backgroundColor: '#f5f5f5',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  headerEmoji: {
    fontSize: 80,
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    backgroundColor: 'white',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  closeButtonText: {
    fontSize: 20,
    color: '#333',
    fontWeight: '600',
  },
  content: {
    padding: 20,
  },
  titleSection: {
    marginBottom: 16,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  truckName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#333',
    flex: 1,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginLeft: 8,
  },
  statusText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  cuisineBadge: {
    backgroundColor: '#FF9800',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  cuisineText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  quickInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  infoCard: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  infoIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  infoLabel: {
    fontSize: 11,
    color: '#666',
    marginBottom: 2,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  inventoryBadge: {
    backgroundColor: '#e7f8ef',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: '#28a745',
  },
  inventoryText: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
  },
  notes: {
    fontSize: 15,
    color: '#666',
    lineHeight: 22,
  },
  address: {
    fontSize: 15,
    color: '#007AFF',
    lineHeight: 22,
  },
  confirmationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e7f8ef',
    padding: 12,
    borderRadius: 8,
    marginBottom: 20,
    flexWrap: 'wrap',
  },
  confirmationIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  confirmationText: {
    fontSize: 14,
    color: '#28a745',
    fontWeight: '500',
    flex: 1,
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  confirmButton: {
    flex: 1,
    backgroundColor: '#4CAF50',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: 'white',
    fontSize: 15,
    fontWeight: '600',
  },
  reportButton: {
    flex: 1,
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#ddd',
  },
  reportButtonText: {
    color: '#333',
    fontSize: 15,
    fontWeight: '600',
  },
  navigateButton: {
    backgroundColor: '#FF9800',
    padding: 18,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  navigateButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  pinButton: {
    flex: 1,
    backgroundColor: '#007AFF',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    },
    pinnedButton: {
        backgroundColor: '#34C759',
    },
  pinButtonText: {
  color: 'white',
  fontSize: 15,
  fontWeight: '600',
  },
});