import cv2
import numpy as np
import tkinter as tk
from tkinter import ttk

def find_cameras(max_index=10):
    available = []
    for i in range(max_index):
        cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)
        if cap.isOpened():
            available.append(i)
            cap.release()
    return available

available_cameras = find_cameras()
if not available_cameras:
    print("No cameras found.")
    exit()

current_cam_index = available_cameras[0]
cap = cv2.VideoCapture(current_cam_index, cv2.CAP_DSHOW)

paper_points = []
drawing = False
prev_point = None

canvas_size = 500
canvas = np.zeros((canvas_size, canvas_size, 3), dtype=np.uint8)

smoothing_factor = 0.25
smoothed_x = None
smoothed_y = None

# ===== TKINTER DROPDOWN =====
root = tk.Tk()
root.title("Camera Select")
root.geometry("220x55")
root.resizable(False, False)
root.attributes("-topmost", True)

camera_var = tk.StringVar(value=f"Camera {current_cam_index}")

def on_camera_change(event):
    global cap, current_cam_index, paper_points, smoothed_x, smoothed_y
    idx = int(camera_var.get().split()[-1])
    if idx != current_cam_index:
        cap.release()
        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
        current_cam_index = idx
        paper_points = []
        smoothed_x = None
        smoothed_y = None

dropdown = ttk.Combobox(
    root,
    textvariable=camera_var,
    values=[f"Camera {i}" for i in available_cameras],
    state="readonly",
    width=18
)
dropdown.pack(pady=10)
dropdown.bind("<<ComboboxSelected>>", on_camera_change)

# ===== OPENCV SETUP =====
def pick_points(event, x, y, flags, param):
    global paper_points
    if event == cv2.EVENT_LBUTTONDOWN:
        if len(paper_points) < 4:
            paper_points.append([x, y])
            print(f"Corner {len(paper_points)} recorded:", (x, y))

cv2.namedWindow("Camera")
cv2.setMouseCallback("Camera", pick_points)

while True:
    root.update()

    ret, frame = cap.read()
    if not ret:
        continue

    thresh = np.zeros((frame.shape[0], frame.shape[1]), dtype=np.uint8)

    display = frame.copy()
    canvas_display = canvas.copy()

    cv2.rectangle(canvas_display, (0,0), (canvas_size-1, canvas_size-1), (255,0,0), 4)

    for pt in paper_points:
        cv2.circle(display, tuple(pt), 6, (0,255,0), -1)

    if len(paper_points) == 4:

        src = np.array(paper_points, dtype=np.float32)
        dst = np.array([
            [0,0],
            [canvas_size,0],
            [canvas_size,canvas_size],
            [0,canvas_size]
        ], dtype=np.float32)

        M = cv2.getPerspectiveTransform(src, dst)

        # ===== BRIGHT POINT DETECTION =====
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (9,9), 0)

        _, thresh = cv2.threshold(blurred, 240, 255, cv2.THRESH_BINARY)

        kernel = np.ones((5,5), np.uint8)
        thresh = cv2.dilate(thresh, kernel, iterations=2)

        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if contours:
            largest = max(contours, key=cv2.contourArea)

            if cv2.contourArea(largest) > 50:
                (x,y),radius = cv2.minEnclosingCircle(largest)
                cx, cy = int(x), int(y)

                # Map to canvas space
                pt = np.array([[[cx,cy]]], dtype=np.float32)
                mapped = cv2.perspectiveTransform(pt, M)[0][0]
                mx, my = int(mapped[0]), int(mapped[1])

                if 0 <= mx < canvas_size and 0 <= my < canvas_size:

                    # ===== SMOOTHING =====
                    if smoothed_x is None:
                        smoothed_x = mx
                        smoothed_y = my
                    else:
                        smoothed_x = int((1 - smoothing_factor) * smoothed_x + smoothing_factor * mx)
                        smoothed_y = int((1 - smoothing_factor) * smoothed_y + smoothing_factor * my)

                    # Cursor (red outlined circle)
                    cv2.circle(canvas_display, (smoothed_x, smoothed_y), 12, (0,0,255), 2)

                    # Drawing logic
                    if drawing:
                        if prev_point is not None:
                            cv2.line(canvas, prev_point, (smoothed_x, smoothed_y), (255,255,255), 4)
                        prev_point = (smoothed_x, smoothed_y)
                    else:
                        prev_point = None

    cv2.imshow("Camera", display)
    cv2.imshow("Threshold", thresh)
    cv2.imshow("Canvas", canvas_display)

    key = cv2.waitKey(1) & 0xFF

    if key == ord('q'):
        break
    elif key == ord('r'):
        canvas[:] = 0
    elif key == ord('d'):
        drawing = True
    else:
        drawing = False

cap.release()
cv2.destroyAllWindows()
root.destroy()
