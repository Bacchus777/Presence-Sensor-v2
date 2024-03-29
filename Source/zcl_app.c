
#include "AF.h"
#include "OSAL.h"
#include "OSAL_Clock.h"
#include "OSAL_PwrMgr.h"
#include "ZComDef.h"
#include "ZDApp.h"
#include "ZDObject.h"
#include "math.h"

#include "nwk_util.h"
#include "zcl.h"
#include "zcl_app.h"
#include "zcl_diagnostic.h"
#include "zcl_general.h"
#include "zcl_ms.h"

#include "bdb.h"
#include "bdb_interface.h"
#include "gp_interface.h"

#include "Debug.h"

#include "OnBoard.h"

#include "commissioning.h"
#include "factory_reset.h"
/* HAL */

#include "hal_adc.h" 
#include "hal_drivers.h"
#include "hal_i2c.h"
#include "hal_key.h"
#include "hal_led.h"

#include "utils.h"
#include "version.h"

#include <stdint.h>
/*********************************************************************
 * MACROS
 */

/*********************************************************************
 * CONSTANTS
 */

/*********************************************************************
 * TYPEDEFS
 */

/*********************************************************************
 * GLOBAL VARIABLES
 */
byte zclApp_TaskID;

// Структура для отправки отчета
afAddrType_t zclApp_DstAddr;
// Номер сообщения
uint8 SeqNum = 0;


uint32 zclApp_GenTime_old = 0;

/*********************************************************************
 * GLOBAL FUNCTIONS
 */
void user_delay_ms(uint32_t period);
void user_delay_ms(uint32_t period) { MicroWait(period * 1000); }
/*********************************************************************
 * LOCAL VARIABLES
 */

afAddrType_t inderect_DstAddr = {.addrMode = (afAddrMode_t)AddrNotPresent, .endPoint = 0, .addr.shortAddr = 0};

static uint8 currentSensorsReadingPhase = 0;

/*********************************************************************
 * LOCAL FUNCTIONS
 */

static void zclApp_SetOutput(void);
static void zclApp_ReadSensors(void);
static void zclApp_Report(void);
static void zclApp_SetOutput(void);
static void zclApp_SetLed(void);
static bool zclApp_in_time(void);

static void zclApp_BasicResetCB(void);
static void zclApp_RestoreAttributesFromNV(void);
static void zclApp_SaveAttributesToNV(void);
static void zclApp_HandleKeys(byte portAndAction, byte keyCode);
static ZStatus_t zclApp_ReadWriteAuthCB(afAddrType_t *srcAddr, zclAttrRec_t *pAttr, uint8 oper);

static void zclApp_reqLocalTime(void);
static uint8 zclApp_ProcessInReadRspCmd(zclIncomingMsg_t *pInMsg);


// Измерение освещенности
static void zclApp_ReadIlluminance(void);
// Изменение включения датчика
static void updateSensor( bool );
// Изменение включения диода
static void updateLed( bool );
// Изменение состояние реле
static void updateOccupancy( bool );
// Отображение включения датчика
static void applySensor( void );
// Отображение включения диода
static void applyLed( void );
// Отправка отчета о включении датчика
void zclApp_ReportOnOff( void );
// Отправка отчета о присутствии
void zclApp_ReportOutput( void );
// Обновление времени
void zclApp_UpdateClock(void);
// Обновление времени
void zclApp_InitValues(void);


/*********************************************************************
 * ZCL General Profile Callback table
 */
static zclGeneral_AppCallbacks_t zclApp_CmdCallbacks1EP = {
    zclApp_BasicResetCB, // Basic Cluster Reset command
    NULL,                // Identify Trigger Effect command
    zclApp_OnOffCB1EP,   // On/Off cluster commands
    NULL,                // On/Off cluster enhanced command Off with Effect
    NULL,                // On/Off cluster enhanced command On with Recall Global Scene
    NULL,                // On/Off cluster enhanced command On with Timed Off
    NULL,                // RSSI Location command
    NULL                 // RSSI Location Response command
};

void zclApp_Init(byte task_id) {
  IO_IMODE_PORT_PIN(LUMOISITY_PORT, LUMOISITY_PIN, IO_TRI);         // tri state p0.7 (lumosity pin)

  HalLedSet(HAL_LED_ALL, HAL_LED_MODE_BLINK);

  zclApp_RestoreAttributesFromNV();

  zclApp_TaskID = task_id;

  bdb_RegisterSimpleDescriptor(&zclApp_FirstEP);

  zclGeneral_RegisterCmdCallbacks(zclApp_FirstEP.EndPoint, &zclApp_CmdCallbacks1EP);

  zcl_registerAttrList(zclApp_FirstEP.EndPoint, zclApp_AttrsFirstEPCount, zclApp_AttrsFirstEP);

  bdb_RegisterSimpleDescriptor(&zclApp_SecondEP);

  zcl_registerAttrList(zclApp_SecondEP.EndPoint, zclApp_AttrsSecondEPCount, zclApp_AttrsSecondEP);

  bdb_RegisterSimpleDescriptor(&zclApp_ThirdEP);

  zcl_registerAttrList(zclApp_ThirdEP.EndPoint, zclApp_AttrsThirdEPCount, zclApp_AttrsThirdEP);

  zcl_registerReadWriteCB(zclApp_FirstEP.EndPoint, NULL, zclApp_ReadWriteAuthCB);

  zcl_registerForMsg(zclApp_TaskID);
  RegisterForKeys(zclApp_TaskID);

  LREP("Build %s \r\n", zclApp_DateCodeNT);
  
  osal_start_reload_timer(zclApp_TaskID, APP_REPORT_EVT, APP_REPORT_DELAY);
  osal_start_reload_timer(zclApp_TaskID, APP_REQ_TIME_EVT, REQ_TIME_INTERVAL);
  osal_start_reload_timer(zclApp_TaskID, APP_INIT_VALUES_EVT, 90000);
  
  LREP("START APP_REPORT_CLOCK_EVT\r\n");
  
}


uint16 zclApp_event_loop(uint8 task_id, uint16 events) {
    LREP("events 0x%x \r\n", events);
    if (events & SYS_EVENT_MSG) {
        afIncomingMSGPacket_t *MSGpkt;
        while ((MSGpkt = (afIncomingMSGPacket_t *)osal_msg_receive(zclApp_TaskID))) {
            LREP("MSGpkt->hdr.event 0x%X clusterId=0x%X\r\n", MSGpkt->hdr.event, MSGpkt->clusterId);
            switch (MSGpkt->hdr.event) {
            case KEY_CHANGE:
                zclApp_HandleKeys(((keyChange_t *)MSGpkt)->state, ((keyChange_t *)MSGpkt)->keys);
                break;

            case ZCL_INCOMING_MSG:
                if (((zclIncomingMsg_t *)MSGpkt)->attrCmd) {
                  zclApp_ProcessInReadRspCmd( (zclIncomingMsg_t *)MSGpkt );
                  osal_mem_free(((zclIncomingMsg_t *)MSGpkt)->attrCmd);
                }
                break;

            default:
                break;
            }

            // Release the memory
            osal_msg_deallocate((uint8 *)MSGpkt);
        }
        // return unprocessed events
        return (events ^ SYS_EVENT_MSG);
    }
    if (events & APP_REPORT_EVT) {
        LREPMaster("APP_REPORT_EVT\r\n");
        zclApp_Report();
        return (events ^ APP_REPORT_EVT);
    }

    if (events & APP_SAVE_ATTRS_EVT) {
        LREPMaster("APP_SAVE_ATTRS_EVT\r\n");
        zclApp_SaveAttributesToNV();
        return (events ^ APP_SAVE_ATTRS_EVT);
    }
    if (events & APP_READ_SENSORS_EVT) {
        LREPMaster("APP_READ_SENSORS_EVT\r\n");
        zclApp_ReadSensors();
        return (events ^ APP_READ_SENSORS_EVT);
    }
    if (events & APP_REQ_TIME_EVT) {
      LREPMaster("APP_REQ_TIME_EVT\r\n");
      zclApp_reqLocalTime();      
      return (events ^ APP_REQ_TIME_EVT);
    }
    if (events & APP_INIT_VALUES_EVT) {
      LREPMaster("APP_INIT_VALUES_EVT\r\n");
      zclApp_InitValues();      
      return (events ^ APP_INIT_VALUES_EVT);
    }

    return 0;
}

// обработка выхода с датчика
static void zclApp_HandleKeys(byte portAndAction, byte keyCode) {
  LREP("zclApp_HandleKeys portAndAction=0x%X keyCode=0x%X\r\n", portAndAction, keyCode);
  if (portAndAction & HAL_KEY_PRESS) {
    updateOccupancy(TRUE);
    osal_start_timerEx(zclApp_TaskID, APP_REPORT_EVT, 200);
  }
  if (portAndAction & HAL_KEY_RELEASE) {
    updateOccupancy(FALSE);
    osal_start_timerEx(zclApp_TaskID, APP_REPORT_EVT, 200);
  }
}

static void zclApp_Report(void) {
  osal_start_reload_timer(zclApp_TaskID, APP_READ_SENSORS_EVT, 10); 
}


static void zclApp_ReadSensors(void) {
  LREP("currentSensorsReadingPhase %d\r\n", currentSensorsReadingPhase);

  switch (currentSensorsReadingPhase++) {
  case 0:
    LREPMaster("zclApp_ReadIlluminance\r\n");
    zclApp_ReadIlluminance();
    break;
  case 1:
    LREPMaster("zclApp_SetOutput\r\n");
    zclApp_SetOutput();
    break;
  case 2:
    LREPMaster("zclApp_SetLed\r\n");
    zclApp_SetLed();
    break;
  case 3:
    LREPMaster("zclApp_UpdateClock\r\n");
    zclApp_UpdateClock();      
    break;
  default:
    LREPMaster("Reset\r\n");
    osal_stop_timerEx(zclApp_TaskID, APP_READ_SENSORS_EVT);
    osal_clear_event(zclApp_TaskID, APP_READ_SENSORS_EVT);
    currentSensorsReadingPhase = 0;
    break;
  }

  LREP("currentSensorsReadingPhase %d\r\n", currentSensorsReadingPhase);

  if (currentSensorsReadingPhase != 0) {
      osal_start_timerEx(zclApp_TaskID, APP_READ_SENSORS_EVT, 10);
  }

}

// Изменение состояния датчика
void updateSensor ( bool value )
{
  zclApp_Config.SensorEnabled = value;

  if (!value) 
    updateOccupancy(FALSE);

  // сохраняем состояние датчика
  zclApp_SaveAttributesToNV();

  // Меняем  датчик
  applySensor();
}
  
// Изменение состояния диода
void updateLed ( bool value )
{
  zclApp_LedEnabled = value;

  // Меняем  диод
  applyLed();
}
  
// Изменение состояния датчика
void updateOccupancy ( bool value )
{
  zclApp_Occupied = (value & zclApp_Config.SensorEnabled);
                     
  LREP("value=%d\r\n", zclApp_Occupied);

  bdb_RepChangedAttrValue(zclApp_FirstEP.EndPoint, OCCUPANCY , ATTRID_MS_OCCUPANCY_SENSING_CONFIG_OCCUPANCY);

  if (zclApp_Occupied)
    zclGeneral_SendOnOff_CmdOn(zclApp_FirstEP.EndPoint, &inderect_DstAddr, TRUE, bdb_getZCLFrameCounter());
  else
    zclGeneral_SendOnOff_CmdOff(zclApp_FirstEP.EndPoint, &inderect_DstAddr, TRUE, bdb_getZCLFrameCounter());
}
  
// Применение состояние датчика
void applySensor ( void )
{
  // если выключено
  if (zclApp_Config.SensorEnabled) {
    // иначе включаем светодиод 2
    HalLedSet ( HAL_LED_2, HAL_LED_MODE_ON );
  } else {
    // то гасим светодиод 2
    HalLedSet ( HAL_LED_2, HAL_LED_MODE_OFF );
  }
}

// Применение состояние диода
void applyLed ( void )
{
  // если выключено
  if (zclApp_LedEnabled) {
    // иначе включаем светодиод 1
    HalLedSet ( HAL_LED_1, HAL_LED_MODE_ON );
  } else {
    // то гасим светодиод 1
    HalLedSet ( HAL_LED_1, HAL_LED_MODE_OFF );
  }
}


static void zclApp_ReadIlluminance(void) {
  HalLedSet(HAL_LED_4, HAL_LED_MODE_ON); 
  zclApp_IlluminanceSensor_MeasuredValue = adcReadSampled(LUMOISITY_PIN, HAL_ADC_RESOLUTION_14, HAL_ADC_REF_AVDD, 5);
  HalLedSet(HAL_LED_4, HAL_LED_MODE_OFF);
  
  bdb_RepChangedAttrValue(zclApp_FirstEP.EndPoint, ILLUMINANCE, ATTRID_MS_ILLUMINANCE_MEASURED_VALUE);
}

static bool zclApp_in_time(void){

  if (zclApp_Config.TimeLow == zclApp_Config.TimeHigh){
    return TRUE;
  }
  else {

    if (zclApp_Config.TimeLow <  zclApp_Config.TimeHigh) {
      return ((osal_getClock() >= zclApp_Config.TimeLow) & (osal_getClock() <= zclApp_Config.TimeHigh));
    } 
    else {
      return ((osal_getClock() < zclApp_Config.TimeLow) ^ (osal_getClock() > zclApp_Config.TimeHigh));
    }
  }
}

static void zclApp_SetOutput(void) {
  bool in_time = zclApp_in_time();
  
  bool in_illuminance = (zclApp_IlluminanceSensor_MeasuredValue <= zclApp_Config.Threshold);
  
  
  LREP("in_time=%d\r\n", in_time);
  LREP("in_illuminance=%d\r\n", in_illuminance);
  LREP("led_mode=%d\r\n", zclApp_Config.LedMode);

  if (zclApp_Occupied) {
    zclApp_Output = (zclApp_Output | (in_illuminance & in_time));
  } else {
    zclApp_Output = FALSE;
  }

  bdb_RepChangedAttrValue(zclApp_SecondEP.EndPoint, GEN_ON_OFF, ATTRID_ON_OFF);

  if (zclApp_Output == 1)
    zclGeneral_SendOnOff_CmdOn(zclApp_SecondEP.EndPoint, &inderect_DstAddr, TRUE, bdb_getZCLFrameCounter());
  else{
    
    if (!zclApp_Occupied) 
      zclGeneral_SendOnOff_CmdOff(zclApp_SecondEP.EndPoint, &inderect_DstAddr, TRUE, bdb_getZCLFrameCounter());
  }
}

static void zclApp_SetLed(void) {

  bool in_time = zclApp_in_time();

  if (zclApp_Config.LedMode == LED_ALWAYS) {
    zclApp_LedEnabled = TRUE;
  }
  else if (zclApp_Config.LedMode == LED_NEVER) {
    zclApp_LedEnabled = FALSE;
  }
  else if (zclApp_Config.LedMode == LED_NIGHT) {
    zclApp_LedEnabled = (zclApp_Occupied & !in_time);
  }

  updateLed(zclApp_LedEnabled);

  bdb_RepChangedAttrValue(zclApp_ThirdEP.EndPoint, GEN_ON_OFF, ATTRID_ON_OFF);

  if (zclApp_LedEnabled)
    zclGeneral_SendOnOff_CmdOn(zclApp_ThirdEP.EndPoint, &inderect_DstAddr, TRUE, bdb_getZCLFrameCounter());
  else {
    zclGeneral_SendOnOff_CmdOff(zclApp_ThirdEP.EndPoint, &inderect_DstAddr, TRUE, bdb_getZCLFrameCounter());

    if (!in_time & !zclApp_Occupied) 
      zclGeneral_SendOnOff_CmdOff(zclApp_SecondEP.EndPoint, &inderect_DstAddr, TRUE, bdb_getZCLFrameCounter());
  }
    
}


// Обработчик команды включения датчика
static void zclApp_OnOffCB1EP(uint8 cmd)
{
  // Включить
  if (cmd == COMMAND_ON) {
    updateSensor(TRUE);
  }
  // Выключить
  else if (cmd == COMMAND_OFF) {
    updateSensor(FALSE);
  }
  // Переключить
  else if (cmd == COMMAND_TOGGLE) {
    updateSensor(!zclApp_Config.SensorEnabled);
  }
}

// сохраниение/чтение настроек

static void zclApp_BasicResetCB(void) {
  LREPMaster("BasicResetCB\r\n");
  zclApp_ResetAttributesToDefaultValues();
  zclApp_SaveAttributesToNV();
}

static ZStatus_t zclApp_ReadWriteAuthCB(afAddrType_t *srcAddr, zclAttrRec_t *pAttr, uint8 oper) {
  LREPMaster("AUTH CB called\r\n");
  osal_start_timerEx(zclApp_TaskID, APP_SAVE_ATTRS_EVT, 2000);
  return ZSuccess;
}

static void zclApp_SaveAttributesToNV(void) {
  uint8 writeStatus = osal_nv_write(NW_APP_CONFIG, 0, sizeof(application_config_t), &zclApp_Config);
  LREP("Saving attributes to NV write=%d\r\n", writeStatus);
  LREP("Delta  = %ld\r\n", zclApp_GenTime_TimeUTC - zclApp_GenTime_old);
  LREP("Delta clock = %ld\r\n", zclApp_GenTime_TimeUTC - osal_getClock());
  if (zclApp_GenTime_TimeUTC != zclApp_GenTime_old) {
    LREPMaster("CHANGE\r\n");
    zclApp_GenTime_old = zclApp_GenTime_TimeUTC;    
    osal_setClock(zclApp_GenTime_TimeUTC + 2);    
  }
}

static void zclApp_RestoreAttributesFromNV(void) {
  uint8 status = osal_nv_item_init(NW_APP_CONFIG, sizeof(application_config_t), NULL);
  LREP("Restoring attributes from NV  status=%d \r\n", status);
  if (status == NV_ITEM_UNINIT) {
    uint8 writeStatus = osal_nv_write(NW_APP_CONFIG, 0, sizeof(application_config_t), &zclApp_Config);
    LREP("NV was empty, writing %d\r\n", writeStatus);
  }
  if (status == ZSUCCESS) {
    LREPMaster("Reading from NV\r\n");
    osal_nv_read(NW_APP_CONFIG, 0, sizeof(application_config_t), &zclApp_Config);
    applySensor();
  }
}


/****************************************************************************
****************************************************************************/

void zclApp_UpdateClock(void)
{
  osalTimeUpdate();
  zclApp_GenTime_TimeUTC = osal_getClock();
  
  if (zclApp_GenTime_TimeUTC > DAY) {
    zclApp_GenTime_TimeUTC -= DAY;
    osal_setClock(zclApp_GenTime_TimeUTC);
  }
 
  LREP("CLOCK = %ld\r\n", osal_getClock());
  LREP("TIME = %ld\r\n", zclApp_GenTime_TimeUTC);
  LREP("TIME_LOW = %ld\r\n", zclApp_Config.TimeLow);
  LREP("TIME_HIGH = %ld\r\n", zclApp_Config.TimeHigh);
}

static void zclApp_reqLocalTime(void) {
  zclReadCmd_t readCmd;
  readCmd.numAttr = 1;
  readCmd.attrID[0] = 7;  // Attribute ID of LocalTime in Cluster Time is 7 (see ZigBee Cluster Library spec)
  zcl_SendRead(1, &inderect_DstAddr, GEN_TIME, &readCmd, ZCL_FRAME_CLIENT_SERVER_DIR, true, SeqNum++);
}

static uint8 zclApp_ProcessInReadRspCmd(zclIncomingMsg_t *pInMsg)
{
  zclReadRspCmd_t * readRspCmd;
  readRspCmd = (zclReadRspCmd_t *) pInMsg->attrCmd;
  
  switch(pInMsg->clusterId)
  {
  case GEN_TIME:
    {
      LREP("TIME = %ld\r\n", zclApp_GenTime_TimeUTC);
      zclApp_GenTime_TimeUTC = * ((uint32 *) readRspCmd->attrList[0].data);
      zclApp_GenTime_TimeUTC %= DAY;
      LREP("TIME = %ld\r\n", zclApp_GenTime_TimeUTC);
      osal_setClock(zclApp_GenTime_TimeUTC);
    }
  break;
  }
  return TRUE;
}

void zclApp_InitValues(void)
{
  uint8 NUM_ATTRIBUTES;
  
  zclApp_reqLocalTime();
  
  NUM_ATTRIBUTES = 3;
  zclReportCmd_t *pReportCmd;
  pReportCmd = osal_mem_alloc(sizeof(zclReportCmd_t) + (NUM_ATTRIBUTES * sizeof(zclReport_t)));
  if (pReportCmd != NULL) {
    pReportCmd->numAttr = NUM_ATTRIBUTES;

    pReportCmd->attrList[0].attrID = ATTRID_TIME_TIME;
    pReportCmd->attrList[0].dataType = ZCL_UTC;
    pReportCmd->attrList[0].attrData = (void *)(&zclApp_GenTime_TimeUTC);

    pReportCmd->attrList[1].attrID = ATTRID_TIME_DST_START;
    pReportCmd->attrList[1].dataType = ZCL_UINT32;
    pReportCmd->attrList[1].attrData = (void *)(&zclApp_Config.TimeLow);

    pReportCmd->attrList[2].attrID = ATTRID_TIME_DST_END;
    pReportCmd->attrList[2].dataType = ZCL_INT32;
    pReportCmd->attrList[2].attrData = (void *)(&zclApp_Config.TimeHigh);
    
    afAddrType_t tmp_inderect_DstAddr = {.addrMode = (afAddrMode_t)AddrNotPresent, .endPoint = FIRST_ENDPOINT, .addr.shortAddr = 0};
    zcl_SendReportCmd(FIRST_ENDPOINT, &tmp_inderect_DstAddr, GEN_TIME, pReportCmd, ZCL_FRAME_CLIENT_SERVER_DIR, TRUE, bdb_getZCLFrameCounter());
  }
  osal_mem_free(pReportCmd);

  NUM_ATTRIBUTES = 1;
  pReportCmd = osal_mem_alloc(sizeof(zclReportCmd_t) + (NUM_ATTRIBUTES * sizeof(zclReport_t)));
  if (pReportCmd != NULL) {
    pReportCmd->numAttr = NUM_ATTRIBUTES;

    pReportCmd->attrList[0].attrID = ATTRID_MS_ILLUMINANCE_TARGET_LEVEL;
    pReportCmd->attrList[0].dataType = ZCL_UINT16;
    pReportCmd->attrList[0].attrData = (void *)(&zclApp_Config.Threshold);

    afAddrType_t tmp_inderect_DstAddr = {.addrMode = (afAddrMode_t)AddrNotPresent, .endPoint = FIRST_ENDPOINT, .addr.shortAddr = 0};
    zcl_SendReportCmd(FIRST_ENDPOINT, &tmp_inderect_DstAddr, ILLUMINANCE_LVL, pReportCmd, ZCL_FRAME_CLIENT_SERVER_DIR, TRUE, bdb_getZCLFrameCounter());
  }
  osal_mem_free(pReportCmd);
  
  NUM_ATTRIBUTES = 1;
  pReportCmd = osal_mem_alloc(sizeof(zclReportCmd_t) + (NUM_ATTRIBUTES * sizeof(zclReport_t)));
  if (pReportCmd != NULL) {
    pReportCmd->numAttr = NUM_ATTRIBUTES;

    pReportCmd->attrList[0].attrID = ATTRID_LED_MODE;
    pReportCmd->attrList[0].dataType = ZCL_DATATYPE_ENUM8;
    pReportCmd->attrList[0].attrData = (void *)(&zclApp_Config.LedMode);

    afAddrType_t tmp_inderect_DstAddr = {.addrMode = (afAddrMode_t)AddrNotPresent, .endPoint = THIRD_ENDPOINT, .addr.shortAddr = 0};
    zcl_SendReportCmd(THIRD_ENDPOINT, &tmp_inderect_DstAddr, GEN_ON_OFF, pReportCmd, ZCL_FRAME_CLIENT_SERVER_DIR, TRUE, bdb_getZCLFrameCounter());
  }
  osal_mem_free(pReportCmd);
  
  osal_stop_timerEx(zclApp_TaskID, APP_INIT_VALUES_EVT);
  osal_clear_event(zclApp_TaskID, APP_INIT_VALUES_EVT);
}
