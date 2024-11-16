#ifndef ZCL_APP_H
#define ZCL_APP_H

#ifdef __cplusplus
extern "C" {
#endif

/*********************************************************************
 * INCLUDES
 */
#include "version.h"
#include "zcl.h"

/*********************************************************************
 * CONSTANTS
 */
  
#define	DAY      86400UL  // 24 hours * 60 minutes * 60 seconds

#define APP_REPORT_DELAY ((uint32)60 * (uint32)1000) // 1 minute

// Application Events
#define APP_REPORT_EVT          0x0001
#define APP_READ_SENSORS_EVT    0x0002
#define APP_SAVE_ATTRS_EVT      0x0004
#define APP_REQ_TIME_EVT        0x0008  

#define INIT_REQ_TIME_INTERVAL  ((uint32) 30000)
#define REQ_TIME_INTERVAL       ((uint32) 1800000)

#define FIRST_ENDPOINT            1
#define SECOND_ENDPOINT           2
#define THIRD_ENDPOINT            3

/*********************************************************************
 * MACROS
 */
#define NW_APP_CONFIG 0x0402

#define R ACCESS_CONTROL_READ
// ACCESS_CONTROL_AUTH_WRITE
#define RW  (R  | ACCESS_CONTROL_WRITE | ACCESS_CONTROL_AUTH_WRITE)
#define RR  (R  | ACCESS_REPORTABLE)
#define RWR (RW | ACCESS_REPORTABLE)

#define BASIC           ZCL_CLUSTER_ID_GEN_BASIC
#define GEN_ON_OFF      ZCL_CLUSTER_ID_GEN_ON_OFF
#define POWER_CFG       ZCL_CLUSTER_ID_GEN_ON
#define OCCUPANCY       ZCL_CLUSTER_ID_MS_OCCUPANCY_SENSING
#define ILLUMINANCE     ZCL_CLUSTER_ID_MS_ILLUMINANCE_MEASUREMENT
#define ILLUMINANCE_LVL ZCL_CLUSTER_ID_MS_ILLUMINANCE_LEVEL_SENSING_CONFIG
#define GEN_TIME        ZCL_CLUSTER_ID_GEN_TIME

#define ATTRID_LED_MODE 0xF004
  
#define ZCL_UINT8       ZCL_DATATYPE_UINT8
#define ZCL_UINT16      ZCL_DATATYPE_UINT16
#define ZCL_INT16       ZCL_DATATYPE_INT16
#define ZCL_INT8        ZCL_DATATYPE_INT8
#define ZCL_INT32       ZCL_DATATYPE_INT32
#define ZCL_UINT32      ZCL_DATATYPE_UINT32
#define ZCL_SINGLE      ZCL_DATATYPE_SINGLE_PREC
#define ZCL_BITMAP8     ZCL_DATATYPE_BITMAP8
#define ZCL_BOOLEAN     ZCL_DATATYPE_BOOLEAN
#define ZCL_UTC         ZCL_DATATYPE_UTC

/*********************************************************************
 * TYPEDEFS
 */

typedef enum {
    LED_ALWAYS, // Светодиод горит всегда
    LED_NEVER,  // Светодиод горит всегда
    LED_NIGHT,  // Светодиод горит всегда
} LedMode_t;

typedef struct {
    bool      SensorEnabled;
    uint16    Threshold;
    uint32    TimeLow;
    uint32    TimeHigh;
    LedMode_t LedMode;
} application_config_t;

/*********************************************************************
 * VARIABLES
 */

extern SimpleDescriptionFormat_t zclApp_FirstEP;
extern CONST zclAttrRec_t zclApp_AttrsFirstEP[];
extern CONST uint8 zclApp_AttrsFirstEPCount;

extern SimpleDescriptionFormat_t zclApp_SecondEP;
extern CONST zclAttrRec_t zclApp_AttrsSecondEP[];
extern CONST uint8 zclApp_AttrsSecondEPCount;

extern SimpleDescriptionFormat_t zclApp_ThirdEP;
extern CONST zclAttrRec_t zclApp_AttrsThirdEP[];
extern CONST uint8 zclApp_AttrsThirdEPCount;


extern const uint8 zclApp_ManufacturerName[];
extern const uint8 zclApp_ModelId[];
extern const uint8 zclApp_PowerSource;

extern bool    zclApp_Occupied; 
extern uint16  zclApp_IlluminanceSensor_MeasuredValue;

extern bool    zclApp_Output; 
extern bool    zclApp_LedEnabled; 

extern application_config_t zclApp_Config;

extern uint32 zclApp_GenTime_TimeUTC;

// APP_TODO: Declare application specific attributes here

/*********************************************************************
 * FUNCTIONS
 */

/*
 * Initialization for the task
 */
extern void zclApp_Init(byte task_id);

/*
 *  Event Process for the task
 */
extern UINT16 zclApp_event_loop(byte task_id, UINT16 events);

extern void zclApp_ResetAttributesToDefaultValues(void);

// Функции работы с кнопками
extern void App_HalKeyPoll ( void );

// Функции команд управления
static void zclApp_OnOffCB1EP(uint8);
static void zclApp_OnOffCB3EP(uint8);


/*********************************************************************
 *********************************************************************/

#ifdef __cplusplus
}
#endif

#endif /* ZCL_APP_H */
