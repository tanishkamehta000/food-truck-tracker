import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebaseConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Session management
let sessionId = null;
let sessionStartTime = null;
let sessionMetrics = {
  reportsSubmitted: 0,
  modalsOpened: 0,
  modalActions: 0, // pin, confirm, navigate
  pinsAdded: 0,
  confirmationsGiven: 0,
  navigationsStarted: 0,
};

// Initialize session
export const initSession = async () => {
  sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  sessionStartTime = Date.now();
  sessionMetrics = {
    reportsSubmitted: 0,
    modalsOpened: 0,
    modalActions: 0,
    pinsAdded: 0,
    confirmationsGiven: 0,
    navigationsStarted: 0,
  };
  
  const userEmail = await AsyncStorage.getItem('userEmail');
  const userType = await AsyncStorage.getItem('userType');
  
  console.log('📊 Analytics session started:', sessionId);
  
  return { sessionId, userEmail, userType };
};

// Get current session
export const getSessionId = () => sessionId;

// Track event
export const trackEvent = async (eventName, eventData = {}) => {
  try {
    const userEmail = await AsyncStorage.getItem('userEmail');
    const userType = await AsyncStorage.getItem('userType');
    
    const analyticsData = {
      eventName,
      sessionId: sessionId || 'unknown',
      timestamp: new Date().toISOString(),
      userEmail: userEmail || 'anonymous',
      userType: userType || 'unknown',
      ...eventData,
    };
    
    // Log locally
    console.log('📊 Analytics:', eventName, eventData);
    
    // Save to Firebase
    await addDoc(collection(db, 'analytics'), analyticsData);
    
    // Update session metrics
    updateSessionMetrics(eventName);
    
  } catch (error) {
    console.error('Analytics tracking error:', error);
  }
};

// Update session metrics based on event
const updateSessionMetrics = (eventName) => {
  switch (eventName) {
    case 'report_submitted':
      sessionMetrics.reportsSubmitted++;
      break;
    case 'modal_opened':
      sessionMetrics.modalsOpened++;
      break;
    case 'modal_action':
      sessionMetrics.modalActions++;
      break;
    case 'truck_pinned':
      sessionMetrics.pinsAdded++;
      sessionMetrics.modalActions++;
      break;
    case 'location_confirmed':
      sessionMetrics.confirmationsGiven++;
      sessionMetrics.modalActions++;
      break;
    case 'navigation_started':
      sessionMetrics.navigationsStarted++;
      sessionMetrics.modalActions++;
      break;
  }
};

// End session and save summary
export const endSession = async () => {
  if (!sessionId) return;
  
  const sessionDuration = Date.now() - sessionStartTime;
  const userEmail = await AsyncStorage.getItem('userEmail');
  const userType = await AsyncStorage.getItem('userType');
  
  try {
    await addDoc(collection(db, 'analytics_sessions'), {
      sessionId,
      userEmail: userEmail || 'anonymous',
      userType: userType || 'unknown',
      startTime: new Date(sessionStartTime).toISOString(),
      endTime: new Date().toISOString(),
      durationMs: sessionDuration,
      durationMinutes: Math.round(sessionDuration / 60000),
      ...sessionMetrics,
      modalAbandonmentRate: sessionMetrics.modalsOpened > 0 
        ? ((sessionMetrics.modalsOpened - sessionMetrics.modalActions) / sessionMetrics.modalsOpened * 100).toFixed(2)
        : 0,
    });
    
    console.log('📊 Session ended:', {
      sessionId,
      duration: `${Math.round(sessionDuration / 1000)}s`,
      ...sessionMetrics,
    });
  } catch (error) {
    console.error('Session end tracking error:', error);
  }
  
  sessionId = null;
  sessionStartTime = null;
};

// Performance tracking
export const trackPerformance = async (metricName, durationMs, metadata = {}) => {
  await trackEvent('performance_metric', {
    metricName,
    durationMs,
    durationSeconds: (durationMs / 1000).toFixed(2),
    ...metadata,
  });
};

// Specific tracking functions
export const trackReportSubmission = async (startTime, truckName, success) => {
  const latency = Date.now() - startTime;
  await trackPerformance('report_submission_latency', latency, {
    truckName,
    success,
    meetsSLA: latency < 3000, // Goal: < 3 seconds
  });
  await trackEvent('report_submitted', { truckName, success, latency });
};

export const trackMapLoad = async (startTime) => {
  const loadTime = Date.now() - startTime;
  await trackPerformance('map_load_time', loadTime, {
    meetsSLA: loadTime < 5000, // Goal: < 5 seconds
  });
};

export const trackModalOpen = async (startTime, truckName) => {
  const openTime = Date.now() - startTime;
  await trackPerformance('modal_open_time', openTime, {
    truckName,
    meetsSLA: openTime < 1000, // Goal: < 1 second
  });
  await trackEvent('modal_opened', { truckName });
};

export const trackModalAction = async (action, truckName) => {
  await trackEvent('modal_action', { action, truckName });
  
  switch (action) {
    case 'pin':
      await trackEvent('truck_pinned', { truckName });
      break;
    case 'confirm':
      await trackEvent('location_confirmed', { truckName });
      break;
    case 'navigate':
      await trackEvent('navigation_started', { truckName });
      break;
    case 'report_issue':
      await trackEvent('issue_reported', { truckName });
      break;
  }
};

export const trackModalClose = async (truckName, actionTaken) => {
  await trackEvent('modal_closed', { 
    truckName, 
    actionTaken,
    abandoned: !actionTaken,
  });
};

export const trackVerification = async (truckName, startTime, confirmationCount) => {
  const verificationTime = Date.now() - startTime;
  const verificationMinutes = Math.round(verificationTime / 60000);
  
  await trackPerformance('verification_time', verificationTime, {
    truckName,
    confirmationCount,
    verificationMinutes,
    meetsSLA: verificationMinutes < 10, // Goal: < 10 minutes
  });
  
  await trackEvent('truck_verified', {
    truckName,
    confirmationCount,
    verificationMinutes,
  });
};

export default {
  initSession,
  endSession,
  trackEvent,
  trackPerformance,
  trackReportSubmission,
  trackMapLoad,
  trackModalOpen,
  trackModalAction,
  trackModalClose,
  trackVerification,
};