Zigbee presence sensor on the LD-2410 sensor

![b8fe096a593931e3e1027fe376b7ba94](https://github.com/user-attachments/assets/12b5d99a-d593-4e85-b732-29c5196ed9f6)

This is the second version of the presence sensor on the LD-2410 chip. The first one was as simple as possible, the firmware was built on PTVO , everything worked well, but I wanted to expand the functionality a little.

A little about the module itself.

![изображение](https://github.com/user-attachments/assets/edf2d343-697f-4d49-a539-a0e54ba520f2)

The supply voltage is 5-12 volts, if you believe the datasheet. Don't believe it. When assembling one, I mixed up the power supplies and connected it to 12 volts. Of course, you couldn't fry an egg on it, but it heated up quite noticeably. And even unpleasantly.

Current consumption - 80 mA. The declared corresponds to the real one.

The radar frequency is 24 GHz. On the one hand, it's good, it doesn't break through three walls. On the other hand, if you crawl under the blanket with your head, then most likely it won't consider you a human.

Dimensions 35x7 mm. Based on the dimensions, the first version of the presence sensor was assembled in a housing from an MR-16 LED lamp.

The module has an output where 3.3 volts appear when it detects a presence. And UART, where when it is turned on it starts to continuously send a long line with all the data.

Unfortunately, not all zigbee devices have a great feature, direct binding. That is, one device sends a command to another directly, bypassing the coordinator, smart home server, etc. That is, a body appears in the toilet - the light turns on. No body - no light. On the one hand, it's good, on the other hand, if it's daytime outside, it's light outside, the sensor is in the hallway, and the sun is shining through the window, then why turn on the light? So, a light sensor and a threshold light value were added to the presence sensor:

![изображение](https://github.com/user-attachments/assets/6bb9ba31-99ef-4847-afde-8cd19c88b3fe)

Now let's go back from the hallway to the toilet. When you go there at night, you don't really want the light to turn on and wake you up completely. That's why the current time and the start and end time of the "day period" were added to the sensor. Led mode is the operating mode of the LED in the sensor (always on, always off, turns on only at night when present)

![изображение](https://github.com/user-attachments/assets/9c16abff-301e-4665-ba54-0740e1a00619)

Accordingly, two sensor outputs were added for binding, "day" and "night".

![изображение](https://github.com/user-attachments/assets/eced2835-d6a7-4976-8b45-4baf9a531c9f)

The first way out is to turn off the microwave sensor itself, for the tinfoil hat cult members. The second and third are the same way outs.

As a result, we have the following algorithm of operation. If the current time is within the specified period and the illumination is below the specified one, the first output is triggered. If the time is outside the specified time, the second one is triggered. This is how easy it is to set up the bathroom light to be turned on during the day and the night light to be turned on at night:

![изображение](https://github.com/user-attachments/assets/9e8400b0-c104-4470-a414-480e5a071de0)

The device diagram has not become much more complicated since the first version:

![изображение](https://github.com/user-attachments/assets/6e665ae7-fdb4-41c1-8337-095966b265bc)

