@echo off
rem Start Manim Slide GUI (Windows).
rem Activates the conda env "manim-slide-gui", then runs run.py.
rem If conda is not found, run "python run.py" from Anaconda Prompt instead.
cd /d "%~dp0"
call conda activate manim-slide-gui
if errorlevel 1 (
  echo Could not activate the conda environment "manim-slide-gui".
  pause
  exit /b 1
)
python run.py %*
pause
