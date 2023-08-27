#define APP_CPU 1
#define PRO_CPU 0

#include "src/OV2640.h"
#include <WiFi.h>
#include <WebServer.h>
#include <WiFiClient.h>
#include "EEPROM.h"

#include <esp_bt.h>
#include <esp_wifi.h>
#include <esp_sleep.h>
#include <driver/rtc_io.h>

#define CAMERA_MODEL_AI_THINKER

#include "camera_pins.h"

OV2640 cam;

#define servo1 12 
#define servo2 13 

int servo1_deg = 90;
int servo2_deg = 90;

int network_connect = 0;

#define SCAN_QR
//#define ENABLE_BLE

#ifdef SCAN_QR
  #include "src/quirc.h"
  struct QRCodeData
  {
    bool valid;
    int dataType;
    uint8_t payload[1024];
    int payloadLen;
  };
  struct quirc *q = NULL;
  uint8_t *image = NULL;  
  struct quirc_code code;
  struct quirc_data data;
  quirc_decode_error_t err;
  struct QRCodeData qrCodeData;  
  String QRCodeResult = "";

  void dumpData(const struct quirc_data *data)
  { 
    QRCodeResult = (const char *)data->payload;
    int index = QRCodeResult.indexOf(",");
    if (index > 0) {
      String id = QRCodeResult.substring(0, index);
      String pw = QRCodeResult.substring(index+1, QRCodeResult.length());
      EEPROM.writeString(0, id);
      EEPROM.writeString(20, pw);
      EEPROM.commit();
      Serial.print("New SSID: ");
      Serial.println(id);
      Serial.print("New Password: ");
      Serial.println(pw);
    }
  }
#endif

#ifdef ENABLE_BLE
  #include <BLEDevice.h>
  #include <BLEServer.h>
  #include <BLEUtils.h>
  #include <BLE2902.h>
  
  BLEServer* pServer = NULL;
  BLECharacteristic* pCharacteristic = NULL;
  bool deviceConnected = false;
  
  #define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
  #define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"
  
  
  class MyServerCallbacks: public BLEServerCallbacks {
      void onConnect(BLEServer* pServer) {
        deviceConnected = true;
      };
  
      void onDisconnect(BLEServer* pServer) {
        deviceConnected = false;
      }
  };
#endif

WebServer server(80);

TaskHandle_t tMjpeg;   
TaskHandle_t tCam;     
TaskHandle_t tStream;  

SemaphoreHandle_t frameSync = NULL;

QueueHandle_t streamingClients;

const int FPS = 14;

const int WSINTERVAL = 100;

void mjpegCB(void* pvParameters) {
  TickType_t xLastWakeTime;
  const TickType_t xFrequency = pdMS_TO_TICKS(WSINTERVAL);

  frameSync = xSemaphoreCreateBinary();
  xSemaphoreGive( frameSync );

  streamingClients = xQueueCreate( 10, sizeof(WiFiClient*) );

  xTaskCreatePinnedToCore(
    camCB,        // callback
    "cam",        // name
    4096,         // stacj size
    NULL,         // parameters
    2,            // priority
    &tCam,        // RTOS task handle
    APP_CPU);     // core

  xTaskCreatePinnedToCore(
    streamCB,
    "strmCB",
    4 * 1024,
    NULL, //(void*) handler,
    2,
    &tStream,
    APP_CPU);

  server.on("/", HTTP_GET, handleJPGSstream);
  server.on("/reset", HTTP_GET, wifi_reset);
  server.on("/servo", HTTP_POST, handle_servo);
  server.onNotFound(handleNotFound);
  server.begin();

  xLastWakeTime = xTaskGetTickCount();
  for (;;) {
    server.handleClient();

    taskYIELD();
    vTaskDelayUntil(&xLastWakeTime, xFrequency);
  }
}

volatile size_t camSize;    // size of the current frame, byte
volatile char* camBuf;      // pointer to the current frame


void camCB(void* pvParameters) {
  TickType_t xLastWakeTime;

  const TickType_t xFrequency = pdMS_TO_TICKS(1000 / FPS);

  portMUX_TYPE xSemaphore = portMUX_INITIALIZER_UNLOCKED;

  char* fbs[2] = { NULL, NULL };
  size_t fSize[2] = { 0, 0 };
  int ifb = 0;

  xLastWakeTime = xTaskGetTickCount();

  for (;;) {

    cam.run();
    size_t s = cam.getSize();

    if (s > fSize[ifb]) {
      fSize[ifb] = s * 4 / 3;
      fbs[ifb] = allocateMemory(fbs[ifb], fSize[ifb]);
    }

    char* b = (char*) cam.getfb();
    memcpy(fbs[ifb], b, s);

    taskYIELD();
    vTaskDelayUntil(&xLastWakeTime, xFrequency);

    xSemaphoreTake( frameSync, portMAX_DELAY );

    portENTER_CRITICAL(&xSemaphore);
    camBuf = fbs[ifb];
    camSize = s;
    ifb++;
    ifb &= 1; 
    portEXIT_CRITICAL(&xSemaphore);

    xSemaphoreGive( frameSync );

    xTaskNotifyGive( tStream );

    taskYIELD();

    if ( eTaskGetState( tStream ) == eSuspended ) {
      vTaskSuspend(NULL);  // passing NULL means "suspend yourself"
    }
  }
}


char* allocateMemory(char* aPtr, size_t aSize) {
  if (aPtr != NULL) free(aPtr);


  size_t freeHeap = ESP.getFreeHeap();
  char* ptr = NULL;

  if ( aSize > freeHeap * 2 / 3 ) {
    if ( psramFound() && ESP.getFreePsram() > aSize ) {
      ptr = (char*) ps_malloc(aSize);
    }
  }
  else {
    //  Enough free heap - let's try allocating fast RAM as a buffer
    ptr = (char*) malloc(aSize);

    //  If allocation on the heap failed, let's give PSRAM one more chance:
    if ( ptr == NULL && psramFound() && ESP.getFreePsram() > aSize) {
      ptr = (char*) ps_malloc(aSize);
    }
  }

  if (ptr == NULL) {
    ESP.restart();
  }
  return ptr;
}

const char HEADER[] = "HTTP/1.1 200 OK\r\n" \
                      "Access-Control-Allow-Origin: *\r\n" \
                      "Content-Type: multipart/x-mixed-replace; boundary=123456789000000000000987654321\r\n";
const char BOUNDARY[] = "\r\n--123456789000000000000987654321\r\n";
const char CTNTTYPE[] = "Content-Type: image/jpeg\r\nContent-Length: ";
const int hdrLen = strlen(HEADER);
const int bdrLen = strlen(BOUNDARY);
const int cntLen = strlen(CTNTTYPE);

void handleJPGSstream(void)
{
  if ( !uxQueueSpacesAvailable(streamingClients) ) return;

  WiFiClient* client = new WiFiClient();
  *client = server.client();

  client->write(HEADER, hdrLen);
  client->write(BOUNDARY, bdrLen);

  xQueueSend(streamingClients, (void *) &client, 0);

  if ( eTaskGetState( tCam ) == eSuspended ) vTaskResume( tCam );
  if ( eTaskGetState( tStream ) == eSuspended ) vTaskResume( tStream );
}

void streamCB(void * pvParameters) {
  char buf[16];
  TickType_t xLastWakeTime;
  TickType_t xFrequency;

  ulTaskNotifyTake( pdTRUE,          
                    portMAX_DELAY ); 

  xLastWakeTime = xTaskGetTickCount();
  for (;;) {
    xFrequency = pdMS_TO_TICKS(1000 / FPS);

    UBaseType_t activeClients = uxQueueMessagesWaiting(streamingClients);
    if ( activeClients ) {
      xFrequency /= activeClients;

      WiFiClient *client;
      xQueueReceive (streamingClients, (void*) &client, 0);

      if (!client->connected()) {
        delete client;
      }
      else {
        xSemaphoreTake( frameSync, portMAX_DELAY );

        client->write(CTNTTYPE, cntLen);
        sprintf(buf, "%d\r\n\r\n", camSize);
        client->write(buf, strlen(buf));
        client->write((char*) camBuf, (size_t)camSize);
        client->write(BOUNDARY, bdrLen);

        xQueueSend(streamingClients, (void *) &client, 0);
        
        xSemaphoreGive( frameSync );
        taskYIELD();
      }
    }
    else {
      vTaskSuspend(NULL);
    }
    taskYIELD();
    vTaskDelayUntil(&xLastWakeTime, xFrequency);
  }
}

const char JHEADER[] = "HTTP/1.1 200 OK\r\n" \
                       "Content-disposition: inline; filename=capture.jpg\r\n" \
                       "Content-type: image/jpeg\r\n\r\n";
const int jhdLen = strlen(JHEADER);

void handle_servo(){
  if(server.argName(0) == "servo1"){
    Serial.print("servo1: ");
    Serial.println(server.arg(0).toInt());
    servo1_deg = server.arg(0).toInt();
    servoWrite(2,servo1_deg);
    
  }
  if(server.argName(0) == "servo2"){
    Serial.print("servo2: ");
    Serial.println(server.arg(0).toInt());
    servo2_deg = server.arg(0).toInt();
    servoWrite(3,servo2_deg);
  }
  server.send(200, "text/plain", "OK");
}

void wifi_reset(){
  for (int i = 0; i < 100; i++){
    EEPROM.write(i, 0);
  }
  EEPROM.commit();
  
  String EEPROM_SSID = EEPROM.readString(0);
  String EEPROM_PWD = EEPROM.readString(20);
  
  const char* ssid = EEPROM_SSID.c_str();
  const char* password = EEPROM_PWD.c_str();

  if(*ssid == NULL) Serial.println("ssid is empty");
  if(*password == NULL) Serial.println("password is empty");
  server.send(200, "text/plain", "OK");
  delay(300);
  if(*ssid == NULL && *password == NULL)ESP.restart();
  else Serial.println("reset fail");
}

void handleNotFound()
{
  String message = "Server is running!\n\n";
  message += "URI: ";
  message += server.uri();
  message += "\nMethod: ";
  message += (server.method() == HTTP_GET) ? "GET" : "POST";
  message += "\nArguments: ";
  message += server.args();
  message += "\n";
  server.send(200, "text / plain", message);
}

void servoWrite(int ch, int deg)
{
  int duty = map(deg, 0, 180, 1638, 8192);
  ledcWrite(ch, duty);
  delay(15); 
}

void setup()
{
  Serial.begin(115200);
  
  EEPROM.begin(100);
  String EEPROM_SSID = EEPROM.readString(0);
  String EEPROM_PWD = EEPROM.readString(20);
  EEPROM_SSID.trim();
  EEPROM_PWD.trim();
  const char* ssid = EEPROM_SSID.c_str();
  const char* password = EEPROM_PWD.c_str();

  Serial.println(ssid);
  Serial.println(password);
  
  #ifdef ENABLE_BLE
    BLEDevice::init("ESP32");
    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MyServerCallbacks());
    BLEService *pService = pServer->createService(SERVICE_UUID);
    pCharacteristic = pService->createCharacteristic(
                        CHARACTERISTIC_UUID,
                        BLECharacteristic::PROPERTY_NOTIFY
                      );                
    pCharacteristic->addDescriptor(new BLE2902());
    pService->start();
    BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
    pAdvertising->addServiceUUID(SERVICE_UUID);
    pAdvertising->setScanResponse(false);
    pAdvertising->setMinPreferred(0x0);
    BLEDevice::startAdvertising();
    Serial.println("scan user");
    for(int i = 0; i <10; i++){
      if (deviceConnected) {
          pCharacteristic->notify();
          Serial.println("connect user");
          delay(500);
          ESP.restart();
      }
      Serial.print(".");
      delay(500);
    }
    Serial.println("user not identified");
    btStop();
  #endif
  
  ledcSetup(2, 50, 16);
  ledcAttachPin(servo1, 2); 
  ledcSetup(3, 50, 16);
  ledcAttachPin(servo2, 3); 
  servoWrite(2,servo1_deg);
  servoWrite(3,servo2_deg); 
  
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  if(*ssid != NULL && *password != NULL){
    config.pixel_format = PIXFORMAT_JPEG;
    config.frame_size = FRAMESIZE_SVGA;
  }
  else{
    config.pixel_format = PIXFORMAT_GRAYSCALE;
    config.frame_size = FRAMESIZE_QVGA;
  }
  
  config.jpeg_quality = 15;
  config.fb_count = 1;

  if (cam.init(config) != ESP_OK) {
    Serial.println("Error initializing the camera");
    delay(10000);
    ESP.restart();
  }

  IPAddress ip;

  if(*ssid != NULL && *password != NULL){
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);
    for (int i = 0; i < 10; i++){
      if(WiFi.status() != WL_CONNECTED){
        delay(500);
        Serial.print(F("."));
      }
      else {
        Serial.println(F("WiFi connected"));
        break;
      }
    }
    if(WiFi.status() == WL_CONNECTED){
      ip = WiFi.localIP();
      Serial.println("");
      Serial.println(ip);
      network_connect = 1;

      xTaskCreatePinnedToCore(
        mjpegCB,
        "mjpeg",
        4 * 1024,
        NULL,
        2,
        &tMjpeg,
        APP_CPU);
    }
    else Serial.println(F("WiFi connect fail"));
  }
  else Serial.println("WiFi data empty!");
}


void loop() {
  if(!network_connect){
    while (1)
    {
      cam.run();
      
      q = quirc_new(); 
      quirc_resize(q, cam.getWidth(), cam.getHeight());
      image = quirc_begin(q, NULL, NULL);
      memcpy(image, (char *)cam.getfb(), cam.getSize());
      quirc_end(q);
  
      Serial.println("Not Found code");
      int count = quirc_count(q);
      if (count > 0) {
        Serial.println(count);
        quirc_extract(q, 0, &code);
        err = quirc_decode(&code, &data);
    
        if (err){
          Serial.println("Decoding FAILED");
          QRCodeResult = "Decoding FAILED";
        } else {
          Serial.printf("Decoding successful:\n");
          dumpData(&data);
          ESP.restart();
        } 
      } 
      
      image = NULL;  
      quirc_destroy(q);
    }
  }
}
