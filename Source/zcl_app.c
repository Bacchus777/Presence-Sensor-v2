
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
#include <string.h>
/*********************************************************************
 * MACROS
 */

/*********************************************************************
 * CONSTANTS
 */

#define RESPONSE_LENGHT     66
#define HLK_RESPONSE_LENGHT 44


uint8 startConfig[14] = {0xFD, 0xFC, 0xFB, 0xFA, 0x04, 0x00, 0xFF, 0x00, 0x01, 0x00, 0x04, 0x03, 0x02, 0x01};
uint8 stopConfig[12]  = {0xFD, 0xFC, 0xFB, 0xFA, 0x02, 0x00, 0xFE, 0x00, 0x04, 0x03, 0x02, 0x01};
uint8 startBits[4]    = {0xF4, 0xF3, 0xF2, 0xF1};
uint8 endBits[4]      = {0xF8, 0xF7, 0xF6, 0xF5};
uint8 engMode[12]     = {0xFD, 0xFC, 0xFB, 0xFA, 0x02, 0x00, 0x62, 0x00, 0x04, 0x03, 0x02, 0x01};
uint8 engModeOff[12]  = {0xFD, 0xFC, 0xFB, 0xFA, 0x02, 0x00, 0x63, 0x00, 0x04, 0x03, 0x02, 0x01};

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

bool readHLK = FALSE;

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
int8 findSubstring(uint8 *array, uint8 arraySize, uint8 *sequence, uint8 sequenceSize, uint8 start);


static void zclApp_SetDayOutput(void);
static void zclApp_ReadSensors(void);
static void zclApp_Report(void);
static void zclApp_SetNightOutput(void);
static bool zclApp_in_time(void);
static void EnableEngMode(void);

static void zclApp_InitHLKUart(void);
static void SerialApp_CallBack(uint8 port, uint8 event);   // Receive data will trigger

static void zclApp_BasicResetCB(void);
static void zclApp_RestoreAttributesFromNV(void);
static void zclApp_SaveAttributesToNV(void);
static void zclApp_HandleKeys(byte portAndAction, byte keyCode);
static ZStatus_t zclApp_ReadWriteAuthCB(afAddrType_t *srcAddr, zclAttrRec_t *pAttr, uint8 oper);

static void zclApp_reqLocalTime(void);
static uint8 zclApp_ProcessInReadRspCmd(zclIncomingMsg_t *pInMsg);


// Запуск чтения датчика
static void zclApp_ReadHLK(void);
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

  HalLedSet(HAL_LED_1, HAL_LED_MODE_BLINK);

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
  zcl_registerReadWriteCB(zclApp_ThirdEP.EndPoint, NULL, zclApp_ReadWriteAuthCB);

  zcl_registerForMsg(zclApp_TaskID);
  RegisterForKeys(zclApp_TaskID);

  LREP("Build %s \r\n", zclApp_DateCodeNT);
  
  osal_start_reload_timer(zclApp_TaskID, APP_REPORT_EVT, APP_REPORT_DELAY);
  osal_start_reload_timer(zclApp_TaskID, APP_REQ_TIME_EVT, INIT_REQ_TIME_INTERVAL);
  
  LREP("START APP_REPORT_CLOCK_EVT\r\n");
  
  zclApp_InitHLKUart();
}

int8 findSubstring(uint8 *array, uint8 arraySize, uint8 *sequence, uint8 sequenceSize, uint8 start) 
{
  if (start > (arraySize - sequenceSize)) 
    return -1;
  
  bool match = true;
  for (int i = start; i < (arraySize - sequenceSize); i++) 
  {
    match = true;
    for (uint8 j = 0; j < sequenceSize; j++){
      match = match & (array[i + j] == sequence[j]);
    }
      

    if (match)
    {
      LREP("match %d \r\n", i);
      return i;
    }

  }

  LREPMaster("not match \r\n");
  return -1;
}

void SerialApp_CallBack(uint8 port, uint8 event)   // Receive data will trigger
{
  if (readHLK)
  {
    uint8 response[RESPONSE_LENGHT] = {0x00};
    HalUARTRead(HLK_PORT, (uint8 *)&response, sizeof(response) / sizeof(response[0]));

      LREPMaster("CALLBACK UART \r\n");
      for (int i = 0; i <= (RESPONSE_LENGHT - 1); i++) 
      {
        LREP("0x%X ", response[i]);
      }
      LREP("\r\n");
    
    int8 startBit = findSubstring(response, RESPONSE_LENGHT, startBits, 4, 0);

    LREP("startBit = %d\r\n", startBit);
    
    if (startBit >= 0) {
      int8 endBit = findSubstring(response, RESPONSE_LENGHT, endBits, 4, startBit);
      
      if (endBit > startBit) {
        if (response[4 + startBit] == 0x23) {

          zclApp_Distance = (uint16)(response[16 + startBit] * 0x100) + (uint16)response[15 + startBit];
          LREP("zclApp_Distance = %d\r\n", zclApp_Distance);

          zclApp_IlluminanceSensor_MeasuredValue = (uint32)((response[37 + startBit]) * 155);
          
          switch (response[8 + startBit]) {
          case 0x00: 
            zclApp_TargetType = TARGET_NONE;
            break;
          case 0x01: 
            zclApp_TargetType = TARGET_MOVING;
            break;
          case 0x02: 
            zclApp_TargetType = TARGET_STATIONARY;
            break;
          case 0x03: 
            zclApp_TargetType = TARGET_ST_AND_MOV;
            break;
          }

          bdb_RepChangedAttrValue(zclApp_FirstEP.EndPoint, ILLUMINANCE, ATTRID_MS_ILLUMINANCE_MEASURED_VALUE);
              
          updateOccupancy(zclApp_Occupied);
          
          readHLK = FALSE;
        }
        else 
          EnableEngMode(); 
      }
    }
  }
}

static void zclApp_InitHLKUart(void) {
  halUARTCfg_t halUARTConfig;
  halUARTConfig.configured = TRUE;
  halUARTConfig.baudRate = HAL_UART_BR_115200;
  halUARTConfig.flowControl = FALSE;
  halUARTConfig.flowControlThreshold = 64; // this parameter indicates number of bytes left before Rx Buffer
                                           // reaches maxRxBufSize
  halUARTConfig.idleTimeout = 10;          // this parameter indicates rx timeout period in millisecond
  halUARTConfig.rx.maxBufSize = 128;
  halUARTConfig.tx.maxBufSize = 128;
  halUARTConfig.intEnable = TRUE;
  halUARTConfig.callBackFunc = SerialApp_CallBack;
  HalUARTInit();
  if (HalUARTOpen(HLK_PORT, &halUARTConfig) == HAL_UART_SUCCESS) {
    LREPMaster("Initialized HLK UART \r\n");
  }
}

static void zclApp_ReadHLK(void) {
  LREPMaster("Read HLK \r\n");

  readHLK = TRUE;
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
    if (events & APP_GET_DISTANCE_EVT) {
      LREPMaster("APP_GET_DISTANCE_EVT\r\n");
      zclApp_ReadHLK();
      return (events ^ APP_GET_DISTANCE_EVT);
    }
    return 0;
}

// обработка выхода с датчика
static void zclApp_HandleKeys(byte portAndAction, byte keyCode) {
  LREP("zclApp_HandleKeys portAndAction=0x%X keyCode=0x%X\r\n", portAndAction, keyCode);
  LREP("HAL_KEY_PORT0 = 0x%X\r\n", HAL_KEY_PORT0);

#if APP_COMMISSIONING_BY_LONG_PRESS
    if (bdbAttributes.bdbNodeIsOnANetwork == 1) {
      zclFactoryResetter_HandleKeys(portAndAction, keyCode);
    }
#else
    zclFactoryResetter_HandleKeys(portAndAction, keyCode);
#endif
    zclCommissioning_HandleKeys(portAndAction, keyCode);

    if (portAndAction & HAL_KEY_PORT0) {

      if (portAndAction & HAL_KEY_PRESS) {
        LREPMaster("OCCUPIED\r\n");
        updateOccupancy(TRUE);
        zclApp_ReadHLK();
        osal_start_timerEx(zclApp_TaskID, APP_REPORT_EVT, 200);
        if (zclApp_Config.MeasurementPeriod > 0)
          osal_start_reload_timer(zclApp_TaskID, APP_GET_DISTANCE_EVT, zclApp_Config.MeasurementPeriod * 1000);
      }
      if (portAndAction & HAL_KEY_RELEASE) {
        updateOccupancy(FALSE);
        osal_start_timerEx(zclApp_TaskID, APP_REPORT_EVT, 200);
        osal_stop_timerEx(zclApp_TaskID, APP_GET_DISTANCE_EVT);
        osal_clear_event(zclApp_TaskID, APP_GET_DISTANCE_EVT);
      }
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
    zclApp_ReadHLK();
    break;
  case 1:
    LREPMaster("zclApp_SetDayOutput\r\n");
    zclApp_SetDayOutput();
    break;
  case 2:
    LREPMaster("zclApp_SetNightOutput\r\n");
    zclApp_SetNightOutput();
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
  zclApp_Led = value;

  // Меняем  диод
  applyLed();
}
  
// Изменение состояния датчика
void updateOccupancy ( bool value )
{
  zclApp_Occupied = (value & zclApp_Config.SensorEnabled);
     
  if (!zclApp_Occupied) {
    zclApp_Distance = 0;
    zclApp_TargetType = TARGET_NONE;
  }
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
    // включаем светодиод 2
    HalLedSet ( HAL_LED_2, HAL_LED_MODE_ON );
    LREPMaster("ENABLE SENSOR\r\n");
//    osal_start_reload_timer(zclApp_TaskID, APP_ENABLE_ENG_EVT, 10000);
  } else {
    // гасим светодиод 2
    HalLedSet ( HAL_LED_2, HAL_LED_MODE_OFF );
  }
}

// Применение состояние диода
void applyLed ( void )
{
  // если выключено
  if (zclApp_Led) {
    // иначе включаем светодиод 1
    HalLedSet ( HAL_LED_1, HAL_LED_MODE_ON );
  } else {
    // то гасим светодиод 1
    HalLedSet ( HAL_LED_1, HAL_LED_MODE_OFF );
  }
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

static void zclApp_SetDayOutput(void) {
  bool in_time = zclApp_in_time();
  
  bool in_illuminance = (zclApp_IlluminanceSensor_MeasuredValue <= zclApp_Config.Threshold);
  
  
  LREP("in_time=%d\r\n", in_time);
  LREP("in_illuminance=%d\r\n", in_illuminance);
  LREP("led_mode=%d\r\n", zclApp_Config.LedMode);

  if (zclApp_Occupied) {
    zclApp_DayOutput = (zclApp_DayOutput | (in_illuminance & in_time));
  } else {
    zclApp_DayOutput = FALSE;
  }

  bdb_RepChangedAttrValue(zclApp_SecondEP.EndPoint, GEN_ON_OFF, ATTRID_ON_OFF);

  if (zclApp_DayOutput)
    zclGeneral_SendOnOff_CmdOn(zclApp_SecondEP.EndPoint, &inderect_DstAddr, TRUE, bdb_getZCLFrameCounter());
  else{
    
    if (!zclApp_Occupied) 
      zclGeneral_SendOnOff_CmdOff(zclApp_SecondEP.EndPoint, &inderect_DstAddr, TRUE, bdb_getZCLFrameCounter());
  }
}

static void zclApp_SetNightOutput(void) {

  bool in_time = zclApp_in_time();

  zclApp_NightOutput = (zclApp_Occupied & !in_time);
  
  switch (zclApp_Config.LedMode) {
    case LED_ALWAYS:
      zclApp_Led = TRUE;
      break;
    case LED_NEVER:
      zclApp_Led = FALSE;
      break;
    case LED_NIGHT:
      zclApp_Led = (zclApp_Occupied & !in_time);
      break;
    default:
      break;
  }

  LREP("zclApp_Led = %d\r\n", zclApp_Led);

  updateLed(zclApp_Led);

  bdb_RepChangedAttrValue(zclApp_ThirdEP.EndPoint, GEN_ON_OFF, ATTRID_ON_OFF);

  if (zclApp_NightOutput)
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
  osal_start_timerEx(zclApp_TaskID, APP_SAVE_ATTRS_EVT, 200);
  return ZSuccess;
}

static void zclApp_SaveAttributesToNV(void) {
  uint8 writeStatus = osal_nv_write(NW_APP_CONFIG, 0, sizeof(application_config_t), &zclApp_Config);
  LREP("Saving attributes to NV write=%d\r\n", writeStatus);
  LREP("Delta  = %ld\r\n", zclApp_GenTime_TimeUTC - zclApp_GenTime_old);
  LREP("Delta clock = %ld\r\n", zclApp_GenTime_TimeUTC - osal_getClock());

  bool in_time = zclApp_in_time();

  LREP("LedMode = %d\r\n", zclApp_Config.LedMode);
  
  switch (zclApp_Config.LedMode) {
    case LED_ALWAYS:
      zclApp_Led = TRUE;
      break;
    case LED_NEVER:
      zclApp_Led = FALSE;
      break;
    case LED_NIGHT:
      zclApp_Led = (zclApp_Occupied & !in_time);
      break;
    default:
      break;
  }

  LREP("zclApp_Led = %d\r\n", zclApp_Led);

  updateLed(zclApp_Led);

  
  if (zclApp_GenTime_TimeUTC != zclApp_GenTime_old) {
    LREPMaster("CHANGE\r\n");
    zclApp_GenTime_old = zclApp_GenTime_TimeUTC;    
    osal_setClock(zclApp_GenTime_TimeUTC + 2);    
  }

  if ((zclApp_Config.MeasurementPeriod > 0) & zclApp_Occupied) 
    osal_start_reload_timer(zclApp_TaskID, APP_GET_DISTANCE_EVT, zclApp_Config.MeasurementPeriod * 1000);

  if (zclApp_Config.MeasurementPeriod == 0){
    osal_stop_timerEx(zclApp_TaskID, APP_GET_DISTANCE_EVT);
    osal_clear_event(zclApp_TaskID, APP_GET_DISTANCE_EVT);
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
  readCmd.attrID[0] = ATTRID_TIME_LOCAL_TIME;  // Attribute ID of LocalTime in Cluster Time is 7 (see ZigBee Cluster Library spec)
  zcl_SendRead(1, &inderect_DstAddr, GEN_TIME, &readCmd, ZCL_FRAME_CLIENT_SERVER_DIR, true, SeqNum++);
  LREPMaster("TIME REQUEST SENT! \r\n");
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

      osal_start_reload_timer(zclApp_TaskID, APP_REQ_TIME_EVT, REQ_TIME_INTERVAL);
    }
  break;
  }
  return TRUE;
}

static void EnableEngMode(void)
{
  HalUARTWrite(HLK_PORT, startConfig, sizeof(startConfig) / sizeof(startConfig[0])); 
  user_delay_ms(200);
  HalUARTWrite(HLK_PORT, engMode, sizeof(engMode) / sizeof(engMode[0])); 
  user_delay_ms(200);
  HalUARTWrite(HLK_PORT, stopConfig, sizeof(stopConfig) / sizeof(stopConfig[0])); 
//  osal_stop_timerEx(zclApp_TaskID, APP_ENABLE_ENG_EVT);
//  osal_clear_event(zclApp_TaskID, APP_ENABLE_ENG_EVT);
}