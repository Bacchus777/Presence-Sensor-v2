#include "AF.h"
#include "OSAL.h"
#include "ZComDef.h"
#include "ZDConfig.h"

#include "zcl.h"
#include "zcl_general.h"
#include "zcl_ha.h"
#include "zcl_ms.h"

#include "zcl_app.h"

#include "version.h"

#include "bdb_touchlink.h"
#include "bdb_touchlink_target.h"
#include "stub_aps.h"

/*********************************************************************
 * CONSTANTS
 */

#define APP_DEVICE_VERSION 2
#define APP_FLAGS 0

#define APP_HWVERSION 1
#define APP_ZCLVERSION 1

/*********************************************************************
 * TYPEDEFS
 */

/*********************************************************************
 * MACROS
 */

/*********************************************************************
 * GLOBAL VARIABLES
 */

// Global attributes
const uint16 zclApp_clusterRevision_all = 0x0002;


bool    zclApp_Occupied = FALSE; 
uint16  zclApp_IlluminanceSensor_MeasuredValue = 0;
bool    zclApp_Output = FALSE;
uint32  zclApp_GenTime_TimeUTC = 0;
bool    zclApp_LedEnabled = FALSE;
uint16  zclApp_M_Distance = 0;
uint16  zclApp_S_Distance = 0;

// Basic Cluster
const uint8 zclApp_HWRevision = APP_HWVERSION;
const uint8 zclApp_ZCLVersion = APP_ZCLVERSION;
const uint8 zclApp_ApplicationVersion = 3;
const uint8 zclApp_StackVersion = 4;

const uint8 zclApp_ManufacturerName[] = {7, 'B', 'a', 'c', 'c', 'h', 'u', 's'};
const uint8 zclApp_ModelId[] = {20, 'P', 'r', 'e', 's', 'e', 'n', 'c', 'e', '_', 'S', 'e', 'n', 's', 'o', 'r', '_', 'v', '2', '.', '5'};
const uint8 zclApp_PowerSource = POWER_SOURCE_MAINS_1_PHASE;


#define DEFAULT_SensorEnabled     TRUE
#define DEFAULT_Threshold         0
#define DEFAULT_TimeLow           0
#define DEFAULT_TimeHigh          0
#define DEFAULT_LedMode           LED_ALWAYS
#define DEFAULT_MeasurementPeriod 15


application_config_t zclApp_Config = {
    .SensorEnabled =      DEFAULT_SensorEnabled,
    .Threshold =          DEFAULT_Threshold,
    .TimeLow =            DEFAULT_TimeLow,
    .TimeHigh =           DEFAULT_TimeHigh,
    .LedMode =            DEFAULT_LedMode,
    .MeasurementPeriod =  DEFAULT_MeasurementPeriod,
};


/*********************************************************************
 * ATTRIBUTE DEFINITIONS - Uses REAL cluster IDs
 */

CONST zclAttrRec_t zclApp_AttrsFirstEP[] = {
    {BASIC, {ATTRID_BASIC_ZCL_VERSION, ZCL_UINT8, R, (void *)&zclApp_ZCLVersion}},
    {BASIC, {ATTRID_BASIC_APPL_VERSION, ZCL_UINT8, R, (void *)&zclApp_ApplicationVersion}},
    {BASIC, {ATTRID_BASIC_STACK_VERSION, ZCL_UINT8, R, (void *)&zclApp_StackVersion}},
    {BASIC, {ATTRID_BASIC_HW_VERSION, ZCL_UINT8, R, (void *)&zclApp_HWRevision}},
    {BASIC, {ATTRID_BASIC_MANUFACTURER_NAME, ZCL_DATATYPE_CHAR_STR, R, (void *)zclApp_ManufacturerName}},
    {BASIC, {ATTRID_BASIC_MODEL_ID, ZCL_DATATYPE_CHAR_STR, R, (void *)zclApp_ModelId}},
    {BASIC, {ATTRID_BASIC_DATE_CODE, ZCL_DATATYPE_CHAR_STR, R, (void *)zclApp_DateCode}},
    {BASIC, {ATTRID_BASIC_POWER_SOURCE, ZCL_DATATYPE_ENUM8, R, (void *)&zclApp_PowerSource}},
    {BASIC, {ATTRID_BASIC_SW_BUILD_ID, ZCL_DATATYPE_CHAR_STR, R, (void *)zclApp_DateCode}},
    {BASIC, {ATTRID_CLUSTER_REVISION, ZCL_UINT16, R, (void *)&zclApp_clusterRevision_all}},

    {GEN_ON_OFF, {ATTRID_ON_OFF, ZCL_BOOLEAN, RWR, (void *)&zclApp_Config.SensorEnabled}},
    {GEN_ON_OFF, {ATTRID_CLUSTER_REVISION, ZCL_INT16, RW, (void *)&zclApp_clusterRevision_all}},

    {OCCUPANCY, {ATTRID_MS_OCCUPANCY_SENSING_CONFIG_OCCUPANCY, ZCL_BITMAP8, RR, (void *)&zclApp_Occupied}},
    {OCCUPANCY, {ATTRID_MS_OCCUPANCY_MOVEMENT_TARGET_DISTANCE, ZCL_UINT16, RR, (void *)&zclApp_M_Distance}},
    {OCCUPANCY, {ATTRID_MS_OCCUPANCY_STATIONARY_TARGET_DISTANCE, ZCL_UINT16, RR, (void *)&zclApp_S_Distance}},
    {OCCUPANCY, {ATTRID_MS_DISTANCE_MEASUREMENT_PERIOD, ZCL_UINT16, RW, (void *)&zclApp_Config.MeasurementPeriod}},
    
    {ILLUMINANCE, {ATTRID_MS_ILLUMINANCE_MEASURED_VALUE, ZCL_UINT16, RR, (void *)&zclApp_IlluminanceSensor_MeasuredValue}},
    {ILLUMINANCE_LVL, {ATTRID_MS_ILLUMINANCE_TARGET_LEVEL, ZCL_UINT16, RW, (void *)&zclApp_Config.Threshold}},

    {GEN_TIME, {ATTRID_TIME_TIME, ZCL_UTC, RW, (void *)&zclApp_GenTime_TimeUTC}},
    {GEN_TIME, {ATTRID_TIME_LOCAL_TIME, ZCL_UINT32, RW, (void *)&zclApp_GenTime_TimeUTC}},
    {GEN_TIME, {ATTRID_TIME_DST_START, ZCL_UINT32, RW, (void *)&zclApp_Config.TimeLow}},
    {GEN_TIME, {ATTRID_TIME_DST_END, ZCL_UINT32, RW, (void *)&zclApp_Config.TimeHigh}}
};

CONST zclAttrRec_t zclApp_AttrsSecondEP[] = {
    {GEN_ON_OFF, {ATTRID_ON_OFF, ZCL_BOOLEAN, RR, (void *)&zclApp_Output}},
};

CONST zclAttrRec_t zclApp_AttrsThirdEP[] = {
    {GEN_ON_OFF, {ATTRID_ON_OFF, ZCL_BOOLEAN, RWR, (void *)&zclApp_LedEnabled}},
    {GEN_ON_OFF, {ATTRID_LED_MODE, ZCL_DATATYPE_ENUM8, RW, (void *)&zclApp_Config.LedMode}},
};

uint8 CONST zclApp_AttrsFirstEPCount = (sizeof(zclApp_AttrsFirstEP) / sizeof(zclApp_AttrsFirstEP[0]));
uint8 CONST zclApp_AttrsSecondEPCount = (sizeof(zclApp_AttrsSecondEP) / sizeof(zclApp_AttrsSecondEP[0]));
uint8 CONST zclApp_AttrsThirdEPCount = (sizeof(zclApp_AttrsThirdEP) / sizeof(zclApp_AttrsThirdEP[0]));
 
const cId_t zclApp_InClusterListFirstEP[] = {
  BASIC,
  ZCL_CLUSTER_ID_GEN_IDENTIFY,
  ZCL_CLUSTER_ID_GEN_GROUPS,
  GEN_ON_OFF,
  OCCUPANCY, 
  ILLUMINANCE,
  GEN_TIME
};

#define APP_MAX_IN_CLUSTERS_FIRST_EP (sizeof(zclApp_InClusterListFirstEP) / sizeof(zclApp_InClusterListFirstEP[0]))

const cId_t zclApp_OutClusterListFirstEP[] = {
  ZCL_CLUSTER_ID_GEN_BASIC,
  GEN_ON_OFF,
  OCCUPANCY, 
  ILLUMINANCE,
  GEN_TIME
};

#define APP_MAX_OUT_CLUSTERS_FIRST_EP (sizeof(zclApp_OutClusterListFirstEP) / sizeof(zclApp_OutClusterListFirstEP[0]))

const cId_t zclApp_OutClusterListSecondEP[] = {
  GEN_ON_OFF
};

#define APP_MAX_OUT_CLUSTERS_SECOND_EP (sizeof(zclApp_OutClusterListSecondEP) / sizeof(zclApp_OutClusterListSecondEP[0]))

const cId_t zclApp_InClusterListThirdEP[] = {
  GEN_ON_OFF
};

#define APP_MAX_IN_CLUSTERS_THIRD_EP (sizeof(zclApp_InClusterListThirdEP) / sizeof(zclApp_InClusterListThirdEP[0]))

const cId_t zclApp_OutClusterListThirdEP[] = {
  GEN_ON_OFF
};

#define APP_MAX_OUT_CLUSTERS_THIRD_EP (sizeof(zclApp_OutClusterListThirdEP) / sizeof(zclApp_OutClusterListThirdEP[0]))


SimpleDescriptionFormat_t zclApp_FirstEP = {
    FIRST_ENDPOINT,                             //  int Endpoint;
    ZCL_HA_PROFILE_ID,                          //  uint16 AppProfId[2];
    ZCL_HA_DEVICEID_SIMPLE_SENSOR,              //  uint16 AppDeviceId[2];
    APP_DEVICE_VERSION,                         //  int   AppDevVer:4;
    APP_FLAGS,                                  //  int   AppFlags:4;
    APP_MAX_IN_CLUSTERS_FIRST_EP,               //  byte  AppNumInClusters;
    (cId_t *)zclApp_InClusterListFirstEP,       //  byte *pAppInClusterList;
    APP_MAX_OUT_CLUSTERS_FIRST_EP,              //  byte  AppNumInClusters;
    (cId_t *)zclApp_OutClusterListFirstEP       //  byte *pAppInClusterList;
};

SimpleDescriptionFormat_t zclApp_SecondEP = {
    SECOND_ENDPOINT,                            //  int Endpoint;
    ZCL_HA_PROFILE_ID,                          //  uint16 AppProfId[2];
    ZCL_HA_DEVICEID_SIMPLE_SENSOR,              //  uint16 AppDeviceId[2];
    APP_DEVICE_VERSION,                         //  int   AppDevVer:4;
    APP_FLAGS,                                  //  int   AppFlags:4;
    0,                                          //  byte  AppNumInClusters;
    (cId_t *)NULL,                              //  byte *pAppInClusterList;
    APP_MAX_OUT_CLUSTERS_SECOND_EP,             //  byte  AppNumInClusters;
    (cId_t *)zclApp_OutClusterListSecondEP      //  byte *pAppInClusterList;
};

SimpleDescriptionFormat_t zclApp_ThirdEP = {
    THIRD_ENDPOINT,                             //  int Endpoint;
    ZCL_HA_PROFILE_ID,                          //  uint16 AppProfId[2];
    ZCL_HA_DEVICEID_SIMPLE_SENSOR,              //  uint16 AppDeviceId[2];
    APP_DEVICE_VERSION,                         //  int   AppDevVer:4;
    APP_FLAGS,                                  //  int   AppFlags:4;
    APP_MAX_IN_CLUSTERS_THIRD_EP,               //  byte  AppNumInClusters;
    (cId_t *)zclApp_InClusterListThirdEP,       //  byte *pAppInClusterList;
    APP_MAX_OUT_CLUSTERS_THIRD_EP,              //  byte  AppNumInClusters;
    (cId_t *)zclApp_OutClusterListThirdEP       //  byte *pAppInClusterList;
};


void zclApp_ResetAttributesToDefaultValues(void) {
    zclApp_Config.SensorEnabled =     DEFAULT_SensorEnabled;
    zclApp_Config.Threshold =         DEFAULT_Threshold;
    zclApp_Config.TimeLow =           DEFAULT_TimeLow;
    zclApp_Config.TimeHigh =          DEFAULT_TimeHigh;
    zclApp_Config.LedMode =           DEFAULT_LedMode;
    zclApp_Config.MeasurementPeriod = DEFAULT_MeasurementPeriod;
}

