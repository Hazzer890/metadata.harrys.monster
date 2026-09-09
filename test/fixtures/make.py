# Regenerates the fixtures. Needs Pillow.  python3 make.py
from PIL import Image
from PIL.PngImagePlugin import PngInfo

img = Image.new("RGB", (8, 8), (200, 40, 40))
exif = Image.Exif()
exif[0x010F] = "TestMake"          # Make
exif[0x0110] = "TestModel"         # Model
exif[0x013B] = "Jane Doe"          # Artist
exif[0x8825] = {                   # GPS IFD
    1: "S", 2: (31.0, 57.0, 0.0),
    3: "E", 4: (115.0, 51.0, 0.0),
}
img.save("photo.jpg", exif=exif.tobytes(), quality=50)
img.save("photo.webp", exif=exif.tobytes(), quality=50)
info = PngInfo(); info.add_text("Comment", "secret note"); info.add_text("Author", "Jane Doe")
img.save("photo.png", pnginfo=info, exif=exif.tobytes())
