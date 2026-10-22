"""Compile/link supplied GLSL ES 3 programs on existing surfaceless EGL.

No browser, network, window, dependency installation, or frame rendering. This
checks Mesa/driver shader acceptance, not WebGL browser/device compatibility.
"""
import ctypes as C
import ctypes.util
import json
import sys


def main():
    egl_path = ctypes.util.find_library('EGL')
    if not egl_path:
        raise RuntimeError('An existing EGL implementation is required.')
    egl = C.CDLL(egl_path)
    egl.eglGetProcAddress.argtypes = [C.c_char_p]
    egl.eglGetProcAddress.restype = C.c_void_p

    def api(name, result, *args):
        address = egl.eglGetProcAddress(name.encode())
        if not address:
            raise RuntimeError(f'Missing EGL/GLES entry point: {name}')
        return C.CFUNCTYPE(result, *args)(address)

    get_display = api('eglGetPlatformDisplayEXT', C.c_void_p, C.c_uint, C.c_void_p, C.POINTER(C.c_int))
    display = get_display(0x31DD, None, None)  # EGL_PLATFORM_SURFACELESS_MESA
    initialize = api('eglInitialize', C.c_uint, C.c_void_p, C.POINTER(C.c_int), C.POINTER(C.c_int))
    major, minor = C.c_int(), C.c_int()
    if not initialize(display, C.byref(major), C.byref(minor)):
        raise RuntimeError('Surfaceless EGL initialization failed.')
    bind = api('eglBindAPI', C.c_uint, C.c_uint)
    if not bind(0x30A0):
        raise RuntimeError('EGL could not bind the OpenGL ES API.')
    choose = api('eglChooseConfig', C.c_uint, C.c_void_p, C.POINTER(C.c_int), C.POINTER(C.c_void_p), C.c_int, C.POINTER(C.c_int))
    attributes = (C.c_int * 9)(0x3033, 1, 0x3040, 0x0040, 0x3024, 8, 0x3021, 8, 0x3038)
    config, count = C.c_void_p(), C.c_int()
    if not choose(display, attributes, C.byref(config), 1, C.byref(count)) or not count.value:
        raise RuntimeError('No EGL ES3 configuration is available.')
    create = api('eglCreateContext', C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p, C.POINTER(C.c_int))
    context = create(display, config, None, (C.c_int * 3)(0x3098, 3, 0x3038))
    current = api('eglMakeCurrent', C.c_uint, C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p)
    if not context or not current(display, None, None, context):
        raise RuntimeError('A surfaceless EGL ES3 context could not be made current.')
    string = api('glGetString', C.c_char_p, C.c_uint)
    create_shader = api('glCreateShader', C.c_uint, C.c_uint)
    source = api('glShaderSource', None, C.c_uint, C.c_int, C.POINTER(C.c_char_p), C.POINTER(C.c_int))
    compile_shader = api('glCompileShader', None, C.c_uint)
    shader_parameter = api('glGetShaderiv', None, C.c_uint, C.c_uint, C.POINTER(C.c_int))
    shader_log = api('glGetShaderInfoLog', None, C.c_uint, C.c_int, C.POINTER(C.c_int), C.c_void_p)
    delete_shader = api('glDeleteShader', None, C.c_uint)
    create_program = api('glCreateProgram', C.c_uint)
    attach = api('glAttachShader', None, C.c_uint, C.c_uint)
    link = api('glLinkProgram', None, C.c_uint)
    program_parameter = api('glGetProgramiv', None, C.c_uint, C.c_uint, C.POINTER(C.c_int))
    program_log = api('glGetProgramInfoLog', None, C.c_uint, C.c_int, C.POINTER(C.c_int), C.c_void_p)
    delete_program = api('glDeleteProgram', None, C.c_uint)

    def log(handle, parameter, retrieve):
        length = C.c_int()
        parameter(handle, 0x8B84, C.byref(length))
        buffer = C.create_string_buffer(max(length.value, 1))
        retrieve(handle, len(buffer), None, buffer)
        return buffer.value.decode(errors='replace')

    results = []
    for item in json.load(sys.stdin):
        program, shaders, failures = create_program(), [], []
        for stage, kind in [('vertex', 0x8B31), ('fragment', 0x8B30)]:
            shader = create_shader(kind)
            data = C.c_char_p(item[stage].encode())
            source(shader, 1, C.byref(data), None)
            compile_shader(shader)
            status = C.c_int()
            shader_parameter(shader, 0x8B81, C.byref(status))
            if not status.value:
                failures.append({'stage': stage, 'log': log(shader, shader_parameter, shader_log)})
            attach(program, shader)
            shaders.append(shader)
        if not failures:
            link(program)
            status = C.c_int()
            program_parameter(program, 0x8B82, C.byref(status))
            if not status.value:
                failures.append({'stage': 'link', 'log': log(program, program_parameter, program_log)})
        results.append({'name': item['name'], 'ok': not failures, 'failures': failures})
        for shader in shaders:
            delete_shader(shader)
        delete_program(program)
    print(json.dumps({'driver': string(0x1F01).decode(), 'version': string(0x1F02).decode(),
                      'programs': len(results), 'passed': sum(r['ok'] for r in results),
                      'failures': [r for r in results if not r['ok']]}))
    current(display, None, None, None)
    api('eglDestroyContext', C.c_uint, C.c_void_p, C.c_void_p)(display, context)
    api('eglTerminate', C.c_uint, C.c_void_p)(display)
    return 1 if any(not r['ok'] for r in results) else 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({'error': str(error)}))
        sys.exit(2)
